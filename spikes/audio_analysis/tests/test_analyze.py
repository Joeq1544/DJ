import hashlib
import importlib.util
import math
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import unittest
import wave


REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATOR = REPO_ROOT / "scripts" / "generate-audio-fixtures.py"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_generator_module():
    spec = importlib.util.spec_from_file_location("audio_fixture_generator", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_irregular_click_wav(path):
    positions = [4_800, 14_400, 48_000, 60_000, 96_000, 110_400, 148_800, 168_000, 211_200]
    frames = 240_000
    clicks = {frame for position in positions for frame in range(position, position + 480)}
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(48_000)
        for start in range(0, frames, 997):
            values = [16_384 if frame in clicks else 0 for frame in range(start, min(start + 997, frames))]
            output.writeframes(struct.pack("<%dh" % len(values), *values))


class AudioAnalysisSpikeTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        result = subprocess.run(
            [sys.executable, str(GENERATOR), "--output", str(self.root)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertIn("clicks.wav", result.stdout)
        self.clicks = self.root / "clicks.wav"
        self.silence = self.root / "silence.wav"
        self.corrupt = self.root / "corrupt.wav"

    def tearDown(self):
        self.tempdir.cleanup()

    def test_generator_creates_the_bound_synthetic_pcm_contract(self):
        """Changing sample positions or amplitudes must break this fixture contract."""
        with wave.open(str(self.clicks), "rb") as source:
            self.assertEqual(source.getnchannels(), 1)
            self.assertEqual(source.getsampwidth(), 2)
            self.assertEqual(source.getframerate(), 48_000)
            self.assertEqual(source.getnframes(), 768_000)
        self.assertEqual(self.silence.stat().st_size, 192_044)
        self.assertLess(self.corrupt.stat().st_size, 44)
        self.assertEqual(sha256(self.clicks), "836f499bdd1c829a55eb0838023eba10f9a884f623a891c6999bffe132f84774")

    def test_generator_exposes_bounded_chunk_iterators(self):
        """Returning a full signal list instead of chunks must fail this memory contract."""
        generator = load_generator_module()
        chunks = generator.iter_click_chunks(chunk_frames=997)
        self.assertFalse(isinstance(chunks, (list, tuple)))
        self.assertLessEqual(len(next(chunks)), 997)
        silence_chunks = generator.iter_silence_chunks(2, chunk_frames=997)
        self.assertFalse(isinstance(silence_chunks, (list, tuple)))
        self.assertLessEqual(len(next(silence_chunks)), 997)

    def test_streaming_measurement_matches_known_click_fixture(self):
        """Wrong PCM scaling, duration, interval, or tempo must change this result."""
        from spikes.audio_analysis.analyze import analyze_file

        before = sha256(self.clicks)
        result = analyze_file(self.clicks, chunk_frames=997)
        self.assertEqual(before, sha256(self.clicks))
        self.assertEqual(result["sample_rate"], 48_000)
        self.assertEqual(result["channels"], 1)
        self.assertAlmostEqual(result["duration_seconds"], 16.0, delta=1 / 48_000)
        self.assertAlmostEqual(result["peak"], 0.50, delta=1 / 32_768)
        self.assertAlmostEqual(result["rms"], math.sqrt(0.003125), delta=1 / 32_768)
        self.assertAlmostEqual(result["median_interval_seconds"], 0.5, delta=1 / 48_000)
        self.assertAlmostEqual(result["bpm"], 120.0, delta=0.05)
        self.assertEqual(result["onset_positions"], [12_000 + 24_000 * n for n in range(32)])
        # Exact amplitude square ratio is 0.50**2 / 0.25**2 = 4.
        self.assertAlmostEqual(result["second_to_first_half_energy_ratio"], 4.0, delta=0.001)
        self.assertGreater(result["confidence"], 0.9)
        self.assertIn("not production MIR", result["limitations"])

    def test_irregular_onsets_have_lower_confidence_than_repeated_clicks(self):
        """Confidence based only on onset count must fail irregular interval evidence."""
        from spikes.audio_analysis.analyze import analyze_file

        irregular = self.root / "irregular.wav"
        write_irregular_click_wav(irregular)
        repeated = analyze_file(self.clicks)
        result = analyze_file(irregular)
        self.assertGreater(repeated["confidence"], 0.9)
        self.assertLess(result["confidence"], 0.6)
        self.assertLess(result["confidence"], repeated["confidence"])

    def test_silence_has_no_tempo_claim(self):
        """Treating silence as a rhythmic source must fail this result."""
        from spikes.audio_analysis.analyze import analyze_file

        result = analyze_file(self.silence)
        self.assertEqual(result["peak"], 0.0)
        self.assertEqual(result["rms"], 0.0)
        self.assertEqual(result["onset_positions"], [])
        self.assertIsNone(result["bpm"])
        self.assertEqual(result["confidence"], 0.0)

    def test_batch_isolates_corrupt_and_timed_out_files_and_cleans_children(self):
        """A malformed or slow item must not suppress valid measurements or leak workers."""
        from multiprocessing import active_children
        from spikes.audio_analysis.analyze import AnalysisJob, analyze_batch

        before_clicks = sha256(self.clicks)
        results = analyze_batch(
            [
                AnalysisJob("valid", self.clicks),
                AnalysisJob("corrupt", self.corrupt),
                AnalysisJob("slow", self.clicks, delay_seconds=1.0),
                AnalysisJob("missing_ready", self.clicks, startup_delay_seconds=3.0),
            ],
            startup_timeout_seconds=2.0,
            timeout_seconds=0.2,
        )
        self.assertEqual(before_clicks, sha256(self.clicks))
        self.assertEqual(results["valid"]["status"], "ok")
        self.assertEqual(results["corrupt"]["status"], "error")
        self.assertIn("WAV", results["corrupt"]["error"])
        self.assertEqual(results["slow"]["status"], "timeout")
        self.assertEqual(results["missing_ready"]["status"], "startup_timeout")
        self.assertEqual(active_children(), [])

    def test_model_asset_validation_rejects_untrusted_paths_hashes_and_executable_formats(self):
        """Weak root/hash/format checks must fail before any model loading could occur."""
        from spikes.audio_analysis.analyze import ModelAssetError, validate_model_asset

        model_root = self.root / "models"
        model_root.mkdir()
        allowed = model_root / "weights.bin"
        allowed.write_bytes(b"safe non-executable weights")
        digest = sha256(allowed)
        self.assertEqual(
            validate_model_asset(allowed, model_root=model_root, allowed_hashes={digest}),
            allowed.resolve(),
        )
        for suffix in (".pickle", ".pt", ".pth"):
            unsafe = model_root / f"unsafe{suffix}"
            unsafe.write_bytes(b"not loaded")
            with self.assertRaises(ModelAssetError):
                validate_model_asset(unsafe, model_root=model_root, allowed_hashes={sha256(unsafe)})
        outside = self.root / "outside.bin"
        outside.write_bytes(b"outside")
        escaped = model_root / "escaped.bin"
        escaped.symlink_to(outside)
        with self.assertRaises(ModelAssetError):
            validate_model_asset(escaped, model_root=model_root, allowed_hashes={sha256(outside)})
        with self.assertRaises(ModelAssetError):
            validate_model_asset(allowed, model_root=model_root, allowed_hashes={"0" * 64})


if __name__ == "__main__":
    unittest.main()
