"""Synthetic tests for the bounded live account verifier."""

from io import BytesIO
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

import p1_account_identity
from verify_p1_account_live import main, read_expected, read_expected_hidden, verify


NUMBER = "+380000000001"


class AccountLiveVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-account-live-")
        self.db = Path(self.temp.name) / "viber.db"
        self.db.write_bytes(b"synthetic")
        self.guard = SimpleNamespace(alive=Mock(return_value=True), close=Mock())
        self.proof = {
            "account_verified": True,
            "proof_method": "expected_e164_matches_guarded_db_directory",
            "account_ref": "a" * 64,
            "source_generation_ref": "b" * 64,
            "account_value_exported": False,
            "database_opened": False,
            "messages_queried": False,
        }

    def tearDown(self):
        self.temp.cleanup()

    def run_verify(self, **changes):
        options = {
            "load_session": Mock(return_value={"hmac_key": b"k" * 32}),
            "capture": Mock(return_value=self.guard),
            "account_path": Mock(return_value=self.db),
            "verify_account": Mock(return_value=self.proof),
        }
        options.update(changes)
        return verify("synthetic-session", NUMBER, **options), options

    def test_success_is_redacted_and_checks_process_twice(self):
        result, options = self.run_verify()
        self.assertEqual(result["status"], "ACCOUNT_VERIFIED")
        self.assertTrue(result["source_continuity_verified"])
        self.assertNotIn(NUMBER, repr(result))
        self.assertEqual(self.guard.alive.call_count, 2)
        self.guard.close.assert_called_once()
        options["verify_account"].assert_called_once_with(NUMBER, b"k" * 32)

    def test_process_or_source_change_fails_closed(self):
        self.guard.alive.side_effect = [True, False]
        result, _ = self.run_verify()
        self.assertEqual(result["error_code"], "SOURCE_CHANGED")
        self.assertFalse(result["account_verified"])
        self.guard.close.assert_called_once()

    def test_identity_error_is_redacted(self):
        failure = p1_account_identity.AccountIdentityError("ACCOUNT_IDENTITY_MISMATCH")
        result, _ = self.run_verify(verify_account=Mock(side_effect=failure))
        self.assertEqual(result["error_code"], "ACCOUNT_IDENTITY_MISMATCH")
        self.assertNotIn(NUMBER, repr(result))

    def test_stage_failures_are_fixed_and_redacted(self):
        cases = [
            ("load_session", Mock(side_effect=RuntimeError("private state detail")), "STATE_UNAVAILABLE"),
            ("account_path", Mock(side_effect=RuntimeError("private path detail")), "ACCOUNT_SOURCE_UNAVAILABLE"),
            ("capture", Mock(side_effect=RuntimeError("private process detail")), "TARGET_UNAVAILABLE"),
            ("verify_account", Mock(side_effect=RuntimeError("private identity detail")), "WORKER_FAILED"),
        ]
        for name, dependency, expected in cases:
            with self.subTest(name=name):
                result, _ = self.run_verify(**{name: dependency})
                self.assertEqual(result["error_code"], expected)
                self.assertNotIn("private", repr(result))

    def test_stdin_requires_one_short_ascii_line(self):
        self.assertEqual(read_expected(BytesIO((NUMBER + "\n").encode("ascii"))), NUMBER)
        for raw in [b"", NUMBER.encode("ascii"), b"+380000000001\r\n", b"+38000000000199999\n", b"\xff\n"]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                read_expected(BytesIO(raw))

    def test_hidden_console_reader_does_not_need_echo_or_prompt(self):
        values = iter(NUMBER + "\r")
        self.assertEqual(read_expected_hidden(lambda: next(values)), NUMBER)
        too_long = iter("+" + "1" * 17 + "\r")
        with self.assertRaises(ValueError):
            read_expected_hidden(lambda: next(too_long))

    def test_cli_error_does_not_load_private_state(self):
        result = main(["--session", "ignored"], BytesIO(b"bad-without-newline"))
        self.assertEqual(result["error_code"], "ACCOUNT_INPUT_INVALID")
        self.assertEqual(result["messages_sent"], 0)


if __name__ == "__main__":
    unittest.main()
