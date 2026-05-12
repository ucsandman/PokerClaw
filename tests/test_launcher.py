"""Stdlib-only unittest suite for poker.py launcher.

Run from the project root:

    python -m unittest tests.test_launcher -v

Vitest only picks up `*.test.{ts,js}`, so this `*.py` file is invisible to it.
"""

import hashlib
import importlib.util
import socket
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER_PATH = PROJECT_ROOT / "poker.py"


def _load_launcher():
    spec = importlib.util.spec_from_file_location("poker_launcher", LAUNCHER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load poker.py at {LAUNCHER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


launcher = _load_launcher()


class RedactHoleCardsTest(unittest.TestCase):
    """Every rank+suit pair must be redacted to '??' before stdout."""

    def test_redacts_each_pair_in_mixed_line(self):
        out = launcher.redact_hole_cards("[bridge] holeCards=AhKd 2c")
        # No card pair should survive.
        self.assertNotIn("Ah", out)
        self.assertNotIn("Kd", out)
        self.assertNotIn("2c", out)
        # Three pairs in the input → three '??' tokens out.
        self.assertEqual(out.count("??"), 3)

    def test_redacts_all_ranks_and_suits(self):
        ranks = "23456789TJQKA"
        suits = "cdhs"
        line = " ".join(f"{r}{s}" for r in ranks for s in suits)
        out = launcher.redact_hole_cards(line)
        # 13 ranks × 4 suits = 52 pairs.
        self.assertEqual(out.count("??"), 52)
        for r in ranks:
            for s in suits:
                self.assertNotIn(f"{r}{s}", out)

    def test_passes_non_card_text_through(self):
        sample = "[launcher] dealer ready, opening http://localhost:5173"
        self.assertEqual(launcher.redact_hole_cards(sample), sample)

    def test_is_case_sensitive_for_ranks(self):
        # Lowercase rank letters are NOT valid hole-card syntax; leave them alone.
        # Only the canonical `[2-9TJQKA][cdhs]` pattern must redact.
        self.assertEqual(launcher.redact_hole_cards("ah kd"), "ah kd")


class BootstrapSha256Test(unittest.TestCase):
    """SHA-256 of the canonical bootstrap text is deterministic + content-bound."""

    def test_is_deterministic_for_canonical_text(self):
        a = launcher.bootstrap_sha256(launcher.BOOTSTRAP_TEXT)
        b = launcher.bootstrap_sha256(launcher.BOOTSTRAP_TEXT)
        self.assertEqual(a, b)
        # Must be a 64-char lowercase hex string (sha-256).
        self.assertEqual(len(a), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in a))

    def test_matches_hashlib_reference(self):
        expected = hashlib.sha256(launcher.BOOTSTRAP_TEXT.encode("utf-8")).hexdigest()
        self.assertEqual(launcher.bootstrap_sha256(launcher.BOOTSTRAP_TEXT), expected)

    def test_changes_when_text_changes(self):
        mutated = launcher.BOOTSTRAP_TEXT + "\nextra"
        self.assertNotEqual(
            launcher.bootstrap_sha256(launcher.BOOTSTRAP_TEXT),
            launcher.bootstrap_sha256(mutated),
        )


class ShouldReseedTest(unittest.TestCase):
    """should_reseed must trigger on missing sentinel, SHA mismatch, or --force-seed."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sentinel = Path(self.tmp.name) / ".poker-seeded"
        self.current = launcher.bootstrap_sha256(launcher.BOOTSTRAP_TEXT)

    def tearDown(self):
        self.tmp.cleanup()

    def test_true_when_sentinel_missing(self):
        self.assertTrue(
            launcher.should_reseed(self.sentinel, self.current, force=False)
        )

    def test_false_when_sentinel_matches(self):
        self.sentinel.write_text(
            f"sha256={self.current}\ndate=2026-05-12\n", encoding="utf-8"
        )
        self.assertFalse(
            launcher.should_reseed(self.sentinel, self.current, force=False)
        )

    def test_true_when_sentinel_sha_differs(self):
        self.sentinel.write_text("sha256=deadbeef\ndate=2026-05-12\n", encoding="utf-8")
        self.assertTrue(
            launcher.should_reseed(self.sentinel, self.current, force=False)
        )

    def test_true_when_force_flag_set(self):
        # Even with a matching sentinel, --force-seed must override.
        self.sentinel.write_text(
            f"sha256={self.current}\ndate=2026-05-12\n", encoding="utf-8"
        )
        self.assertTrue(launcher.should_reseed(self.sentinel, self.current, force=True))


class ValidateAgentIdTest(unittest.TestCase):
    """validate_agent_id mirrors the bridge's banned-id guard."""

    def test_rejects_main(self):
        with self.assertRaises(ValueError):
            launcher.validate_agent_id("main")

    def test_rejects_main_case_insensitive(self):
        with self.assertRaises(ValueError):
            launcher.validate_agent_id("Main")
        with self.assertRaises(ValueError):
            launcher.validate_agent_id("MAIN")

    def test_rejects_other_banned_aliases(self):
        # Bridge banlist: main, default, primary, moltfire, moltfire-main.
        for banned in ("default", "primary", "moltfire", "moltfire-main"):
            with self.assertRaises(ValueError):
                launcher.validate_agent_id(banned)

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            launcher.validate_agent_id("")
        with self.assertRaises(ValueError):
            launcher.validate_agent_id("   ")

    def test_accepts_moltfire_poker(self):
        # No exception, and the trimmed value is returned for downstream use.
        self.assertEqual(launcher.validate_agent_id("moltfire-poker"), "moltfire-poker")
        self.assertEqual(
            launcher.validate_agent_id("  moltfire-poker  "), "moltfire-poker"
        )


class PortPrecheckTest(unittest.TestCase):
    """is_port_free is True when nothing is bound, False when a socket holds it."""

    def _pick_unused_port(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]
        finally:
            s.close()

    def test_returns_true_when_port_is_free(self):
        port = self._pick_unused_port()
        self.assertTrue(launcher.is_port_free(port, host="127.0.0.1"))

    def test_returns_false_when_port_is_occupied(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        try:
            s.bind(("127.0.0.1", 0))
            s.listen(1)
            port = s.getsockname()[1]
            self.assertFalse(launcher.is_port_free(port, host="127.0.0.1"))
        finally:
            s.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
