from __future__ import annotations

import importlib
import json
import sys
import unittest
from pathlib import Path

from mcp import types


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ContractTests(unittest.TestCase):
    def contract(self):
        try:
            return importlib.import_module("contract")
        except ModuleNotFoundError:
            self.fail("contract module is unavailable")

    def test_listing_exposes_exact_closed_schemas_and_safe_annotations(self) -> None:
        tool = self.contract().tool_definition()

        self.assertEqual(tool.name, "echo_library_ids")
        self.assertEqual(tool.description, "Echo fixture library IDs after strict local validation.")
        self.assertEqual(
            tool.input_schema,
            {
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 5,
                    }
                },
                "required": ["ids"],
                "additionalProperties": False,
            },
        )
        self.assertEqual(
            tool.output_schema,
            {
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "fixture-1",
                                "fixture-2",
                                "fixture-3",
                                "fixture-4",
                                "fixture-5",
                                "fixture-1234567890",
                            ],
                        },
                        "minItems": 1,
                        "maxItems": 5,
                    }
                },
                "required": ["ids"],
                "additionalProperties": False,
            },
        )
        self.assertEqual(
            tool.annotations.model_dump(by_alias=True, exclude_none=True),
            {
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
        )

    def test_known_ids_return_bounded_equivalent_text_and_structured_content(self) -> None:
        contract = self.contract()
        result = contract.call_echo_library_ids({"ids": ["fixture-2", "fixture-1"]})

        self.assertFalse(result.is_error)
        self.assertEqual(len(result.content), 1)
        self.assertIsInstance(result.content[0], types.TextContent)
        self.assertEqual(result.content[0].text, '{"ids":["fixture-2","fixture-1"]}')
        self.assertEqual(result.structured_content, {"ids": ["fixture-2", "fixture-1"]})
        self.assertEqual(contract.validate_echo_library_ids_result(result), {"ids": ["fixture-2", "fixture-1"]})
        self.assertLessEqual(len(result.model_dump_json(by_alias=True).encode("utf-8")), 512)

    def test_unknown_extra_empty_and_over_limit_inputs_return_one_sanitized_error(self) -> None:
        contract = self.contract()
        invalid = [
            {"ids": ["not-in-library"]},
            {"ids": ["fixture-1"], "command": "read /private/secret"},
            {"ids": []},
            {"ids": ["fixture-1", "fixture-2", "fixture-3", "fixture-4", "fixture-5", "fixture-1"]},
            None,
        ]

        for arguments in invalid:
            with self.subTest(arguments=arguments):
                result = contract.call_echo_library_ids(arguments)
                self.assertTrue(result.is_error)
                self.assertEqual(len(result.content), 1)
                self.assertEqual(result.content[0].text, "invalid echo_library_ids input")
                self.assertIsNone(result.structured_content)
                serialized = result.model_dump_json(by_alias=True)
                self.assertNotIn("secret", serialized)
                self.assertLessEqual(len(serialized.encode("utf-8")), 512)

    def test_independent_result_validation_rejects_invalid_or_unequal_shapes(self) -> None:
        contract = self.contract()
        invalid_results = [
            types.CallToolResult(
                content=[types.TextContent(text='{"ids":["fixture-1"],"extra":true}')],
                structured_content={"ids": ["fixture-1"], "extra": True},
                is_error=False,
            ),
            types.CallToolResult(
                content=[types.TextContent(text='{"ids":["unknown"]}')],
                structured_content={"ids": ["unknown"]},
                is_error=False,
            ),
            types.CallToolResult(
                content=[types.TextContent(text=json.dumps({"ids": ["fixture-1"] * 6}))],
                structured_content={"ids": ["fixture-1"] * 6},
                is_error=False,
            ),
            types.CallToolResult(
                content=[types.TextContent(text='{"ids":["fixture-2"]}')],
                structured_content={"ids": ["fixture-1"]},
                is_error=False,
            ),
            types.CallToolResult(
                content=[types.TextContent(text="invalid echo_library_ids input")],
                is_error=True,
            ),
        ]

        for result in invalid_results:
            with self.subTest(result=result):
                with self.assertRaisesRegex(ValueError, "invalid echo_library_ids result"):
                    contract.validate_echo_library_ids_result(result)


if __name__ == "__main__":
    unittest.main()
