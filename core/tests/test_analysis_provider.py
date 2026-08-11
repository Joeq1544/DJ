import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPO_ROOT / "scripts" / "generate-audio-fixtures.py"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class AnalysisProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tempdir.name)
        subprocess.run(
            [sys.executable, str(GENERATOR), "--output", str(cls.root)],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        cls.harmonic = cls.root / "harmonic.wav"
        cls.silence = cls.root / "silence.wav"
        cls.corrupt = cls.root / "corrupt.wav"
        cls.no_audio = cls.root / "no-audio.mp4"
        cls.ffmpeg = shutil.which("ffmpeg")
        cls.ffprobe = shutil.which("ffprobe")
        if not cls.ffmpeg or not cls.ffprobe:
            raise unittest.SkipTest("FFmpeg and ffprobe 8.1.2 are required")
        subprocess.run(
            [
                cls.ffmpeg,
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=16x16:d=0.1",
                "-an",
                "-y",
                str(cls.no_audio),
            ],
            check=True,
            capture_output=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.tempdir.cleanup()

    def provider(self, **kwargs):
        from core.dj_copilot.analysis import FfmpegNumpyProvider

        return FfmpegNumpyProvider(
            ffmpeg_path=kwargs.get("ffmpeg_path", self.ffmpeg),
            ffprobe_path=kwargs.get("ffprobe_path", self.ffprobe),
        )

    def decode_delays(self, *, test_mode, delay_ms, source=None):
        environment = {
            "DJ_COPILOT_TEST_MODE": test_mode,
            "DJ_COPILOT_ANALYSIS_TEST_DELAY_MS": delay_ms,
        }
        with patch.dict(os.environ, environment, clear=False):
            with patch("core.dj_copilot.analysis.provider.time.sleep") as sleeper:
                self.provider().analyze(
                    source or self.silence,
                    progress=lambda _value: None,
                    should_stop=lambda: False,
                )
        return [call.args[0] for call in sleeper.call_args_list]

    def test_capabilities_record_exact_local_pipeline_provenance(self):
        """Wrong executable, NumPy, provider, or pipeline versions must disable analysis."""
        capabilities = self.provider().capabilities()
        self.assertTrue(capabilities.available, capabilities.unavailable_reason)
        self.assertEqual(capabilities.provider, "ffmpeg-numpy-basic")
        self.assertEqual(
            capabilities.provider_version,
            "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
        )
        self.assertEqual(capabilities.pipeline_version, "baseline-v1")
        self.assertEqual(capabilities.available_stages, ("metadata", "basic_features"))
        self.assertEqual(capabilities.unavailable_stages, ("structure", "embeddings"))
        self.assertIsNone(capabilities.unavailable_reason)

    def test_executable_version_mismatch_is_an_unavailable_capability(self):
        """Accepting an unreviewed FFmpeg version must fail closed before analysis."""
        fake = self.root / "wrong-ffmpeg"
        fake.write_text("#!/bin/sh\necho 'ffmpeg version 7.0'\n", encoding="utf-8")
        fake.chmod(0o700)
        capabilities = self.provider(ffmpeg_path=fake).capabilities()
        self.assertFalse(capabilities.available)
        self.assertIsNone(capabilities.provider_version)
        self.assertIn("ffmpeg version 8.1.2", capabilities.unavailable_reason)

    def test_fingerprint_is_fast_metadata_and_edge_content_evidence(self):
        """Reading or mutating complete source media must fail the fingerprint contract."""
        provider = self.provider()
        source_hash = sha256(self.harmonic)
        fingerprint, size, mtime_ns = provider.fingerprint(self.harmonic)
        self.assertEqual(len(fingerprint), 64)
        self.assertEqual(size, self.harmonic.stat().st_size)
        self.assertEqual(mtime_ns, self.harmonic.stat().st_mtime_ns)
        self.assertEqual(sha256(self.harmonic), source_hash)

    def test_generated_harmonic_analysis_is_versioned_bounded_and_streamed(self):
        """Broken tempo/key extraction, scaling, progress, or temp decoding must fail here."""
        provider = self.provider()
        source_hash = sha256(self.harmonic)
        paths_before = sorted(path.relative_to(self.root) for path in self.root.rglob("*"))
        progress = []
        features = provider.analyze(
            self.harmonic,
            progress=progress.append,
            should_stop=lambda: False,
        )
        self.assertEqual(sha256(self.harmonic), source_hash)
        self.assertEqual(sorted(path.relative_to(self.root) for path in self.root.rglob("*")), paths_before)
        self.assertEqual(progress[0], 0)
        self.assertEqual(progress[-1], 1_000_000)
        self.assertEqual(progress, sorted(progress))
        self.assertTrue(all(0 <= value <= 1_000_000 for value in progress))
        self.assertEqual(features.codec, "pcm_s16le")
        self.assertEqual(features.container, "wav")
        self.assertEqual(features.duration_ms, 16_000)
        self.assertEqual(features.sample_rate_hz, 48_000)
        self.assertEqual(features.channels, 1)
        self.assertEqual(features.bpm_milli, 120_000)
        self.assertGreaterEqual(features.tempo_confidence_ppm, 850_000)
        self.assertEqual((features.musical_key, features.mode), ("C", "major"))
        self.assertGreaterEqual(features.key_confidence_ppm, 500_000)
        self.assertEqual(len(features.energy_curve_ppm), 16)
        self.assertGreater(features.energy_curve_ppm[-1], features.energy_curve_ppm[0])
        self.assertEqual(features.provider, "ffmpeg-numpy-basic")
        self.assertEqual(
            features.provider_version,
            "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
        )
        self.assertEqual(features.pipeline_version, "baseline-v1")
        self.assertIn(
            "Heuristic tempo and beat evidence; not a Rekordbox beat grid.",
            features.limitations,
        )
        self.assertIn(
            "Heuristic key/mode evidence; verify low-confidence results by ear.",
            features.limitations,
        )

    def test_silence_returns_unknown_tempo_and_key(self):
        """Low-information audio must not produce invented musical claims."""
        source_hash = sha256(self.silence)
        silence = self.provider().analyze(
            self.silence,
            progress=lambda _value: None,
            should_stop=lambda: False,
        )
        self.assertEqual(sha256(self.silence), source_hash)
        self.assertEqual(silence.bpm_milli, None)
        self.assertEqual((silence.musical_key, silence.mode), (None, None))
        self.assertEqual(silence.tempo_confidence_ppm, 0)
        self.assertEqual(silence.key_confidence_ppm, 0)

    def test_missing_corrupt_and_no_audio_fail_with_stable_codes(self):
        """Collapsing distinct per-track media failures must fail the queue-facing contract."""
        from core.dj_copilot.analysis import AnalysisProviderError

        cases = (
            (self.root / "missing.wav", "missing_file"),
            (self.corrupt, "invalid_media"),
            (self.no_audio, "no_audio"),
        )
        provider = self.provider()
        for path, expected_code in cases:
            with self.subTest(code=expected_code):
                with self.assertRaises(AnalysisProviderError) as raised:
                    provider.analyze(path, progress=lambda _value: None, should_stop=lambda: False)
                self.assertEqual(raised.exception.code, expected_code)

    def test_cooperative_stop_raises_analysis_interrupted(self):
        """Ignoring a queue pause request must fail before a result can be returned."""
        from core.dj_copilot.analysis import AnalysisInterrupted

        with self.assertRaises(AnalysisInterrupted) as raised:
            self.provider().analyze(
                self.harmonic,
                progress=lambda _value: None,
                should_stop=lambda: True,
            )
        self.assertEqual(raised.exception.code, "interrupted")

    def test_test_mode_delay_is_injected_between_local_provider_chunks(self):
        """Ignoring a valid test-only delay must make the restart flow too fast to pause."""
        delays = self.decode_delays(test_mode="1", delay_ms="75", source=self.harmonic)

        self.assertGreater(len(delays), 1)
        self.assertEqual(set(delays), {0.075})

    def test_test_mode_delay_accepts_the_inclusive_integer_boundaries(self):
        """Rejecting 250ms or sleeping for the zero boundary must fail the bounded contract."""
        self.assertEqual(self.decode_delays(test_mode="1", delay_ms="0"), [])
        upper_bound_delays = self.decode_delays(test_mode="1", delay_ms="250")
        self.assertGreater(len(upper_bound_delays), 0)
        self.assertEqual(set(upper_bound_delays), {0.25})

    def test_test_mode_delay_is_disabled_outside_exact_test_mode_and_for_invalid_values(self):
        """Production mode or ambiguous/out-of-range strings must never slow local analysis."""
        cases = (
            ("0", "75"),
            ("01", "75"),
            ("", "75"),
            ("1", "-1"),
            ("1", "251"),
            ("1", "75.0"),
            ("1", " 75"),
            ("1", "+75"),
            ("1", "075"),
        )
        for test_mode, delay_ms in cases:
            with self.subTest(test_mode=test_mode, delay_ms=delay_ms):
                self.assertEqual(
                    self.decode_delays(test_mode=test_mode, delay_ms=delay_ms),
                    [],
                )


if __name__ == "__main__":
    unittest.main()
