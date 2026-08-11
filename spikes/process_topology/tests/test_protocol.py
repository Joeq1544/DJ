import importlib
import json
import struct
import unittest


def require_module(test, name):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        test.fail(f"required spike module is not implemented: {exc.name}")


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.protocol = require_module(self, "spikes.process_topology.protocol")

    def test_canonical_json_is_stable_and_rejects_all_floating_point_numbers(self):
        self.assertEqual(
            self.protocol.canonical_json({"z": "é", "a": [2, 1]}),
            b'{"a":[2,1],"z":"\xc3\xa9"}',
        )
        with self.assertRaisesRegex(ValueError, "finite"):
            self.protocol.canonical_json({"bad": float("nan")})
        for value in (1.0, -0.0, 1e-7, 1e20):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "integer-only"):
                self.protocol.canonical_json({"unsupported": value})

    def test_split_and_coalesced_frames_decode_without_loss(self):
        first = self.protocol.encode_frame({"kind": "one"})
        second = self.protocol.encode_frame({"kind": "two"})
        decoder = self.protocol.FrameDecoder()
        self.assertEqual(decoder.feed(first[:2]), [])
        self.assertEqual(decoder.feed(first[2:] + second), [{"kind": "one"}, {"kind": "two"}])
        decoder.finish()

    def test_size_is_rejected_from_header_before_payload_arrives(self):
        for length, code in ((0, "frame_empty"), (65537, "frame_too_large")):
            decoder = self.protocol.FrameDecoder()
            with self.subTest(length=length), self.assertRaises(self.protocol.ProtocolError) as raised:
                decoder.feed(struct.pack(">I", length))
            self.assertEqual(raised.exception.code, code)

    def test_invalid_payloads_and_incomplete_trailing_frames_are_rejected(self):
        cases = [
            (b"\xff", "invalid_utf8"),
            (b"[]", "invalid_top_level"),
            (b'{"a":1,"a":2}', "duplicate_key"),
            (b'{"x":NaN}', "invalid_json_constant"),
            (b'{"x":1e999}', "invalid_json_constant"),
            (b'{"x":1.0}', "float_contract_unsupported"),
            (b'{"x":-0.0}', "float_contract_unsupported"),
            (b'{"x":1e-7}', "float_contract_unsupported"),
            (b'{"x":1e20}', "float_contract_unsupported"),
            (b'{"x":"\\ud800"}', "invalid_unicode"),
            (b'{"x":9223372036854775808}', "integer_out_of_range"),
            (b'{"x":-9223372036854775809}', "integer_out_of_range"),
            (b'{"x":' + (b'9' * 5000) + b'}', "integer_out_of_range"),
            (b'{"x":-' + (b'9' * 5000) + b'}', "integer_out_of_range"),
            (b'{"x":' + (b'[' * 34) + b'0' + (b']' * 34) + b'}', "json_too_deep"),
            (b'{"x":[' + b','.join([b'0'] * 4097) + b']}', "json_too_many_nodes"),
            (b'{not-json}', "invalid_json"),
        ]
        for payload, code in cases:
            decoder = self.protocol.FrameDecoder()
            with self.subTest(code=code):
                try:
                    decoder.feed(struct.pack(">I", len(payload)) + payload)
                except self.protocol.ProtocolError as raised:
                    self.assertEqual(raised.code, code)
                except Exception as exc:
                    self.fail(f"hostile JSON escaped as raw {type(exc).__name__}: {exc}")
                else:
                    self.fail(f"hostile JSON was accepted instead of {code}")

        for partial in (b"\x00", struct.pack(">I", 8) + b'{"x"'):
            decoder = self.protocol.FrameDecoder()
            decoder.feed(partial)
            with self.assertRaises(self.protocol.ProtocolError) as raised:
                decoder.finish()
            self.assertEqual(raised.exception.code, "incomplete_frame")

        parser_bomb = b'{"x":' + (b'[' * 1100) + b'0' + (b']' * 1100) + b'}'
        decoder = self.protocol.FrameDecoder()
        with self.assertRaises(self.protocol.ProtocolError) as raised:
            decoder.feed(struct.pack(">I", len(parser_bomb)) + parser_bomb)
        self.assertEqual(raised.exception.code, "json_too_deep")

        try:
            signed_bounds = self.protocol.decode_payload(
                b'{"min":-9223372036854775808,"max":9223372036854775807}'
            )
        except Exception as exc:
            self.fail(f"valid signed-64 boundary was rejected: {type(exc).__name__}: {exc}")
        self.assertEqual(signed_bounds, {"min": -9223372036854775808, "max": 9223372036854775807})

    def test_handshake_and_request_schema_errors_are_stable(self):
        valid = {
            "type": "handshake", "version": 1, "role": "trusted-main",
            "session_id": "main-1", "capability": "t" * 43,
        }
        try:
            accepted = self.protocol.validate_handshake(valid)
        except self.protocol.ProtocolError as exc:
            self.fail(f"role-bound capability handshake was rejected: {exc.code}")
        self.assertEqual(accepted, valid)
        bad_cases = [
            ({}, "handshake_required"),
            ({**valid, "version": 2}, "version_mismatch"),
            ({**valid, "version": True}, "version_mismatch"),
            ({**valid, "role": "other"}, "invalid_role"),
            ({**valid, "session_id": ""}, "invalid_session_id"),
            ({key: value for key, value in valid.items() if key != "capability"}, "invalid_handshake_capability"),
            ({**valid, "capability": "é" * 32}, "invalid_handshake_capability"),
        ]
        for value, code in bad_cases:
            with self.subTest(code=code):
                with self.assertRaises(self.protocol.ProtocolError) as raised:
                    self.protocol.validate_handshake(value)
                self.assertEqual(raised.exception.code, code)

        request = {"type": "request", "id": "r1", "operation": "ping", "payload": {}}
        self.assertEqual(self.protocol.validate_request(request), request)
        with self.assertRaises(self.protocol.ProtocolError) as raised:
            self.protocol.validate_request({**request, "payload": []})
        self.assertEqual(raised.exception.code, "invalid_request_payload")

    def test_crash_loop_policy_is_bounded(self):
        policy = self.protocol.CrashLoopPolicy(max_restarts=2, window_seconds=10, base_delay=0.25)
        self.assertEqual(policy.record_crash(100.0), 0.25)
        self.assertEqual(policy.record_crash(101.0), 0.5)
        self.assertIsNone(policy.record_crash(102.0))
        self.assertEqual(policy.record_crash(120.0), 0.25)


if __name__ == "__main__":
    unittest.main()
