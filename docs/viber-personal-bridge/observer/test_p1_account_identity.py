"""Synthetic account-directory identity tests; no real Viber profile access."""

from pathlib import Path
import tempfile
import unittest

from p1_account_identity import AccountIdentityError, verify_layout


NUMBER = "+380000000001"
KEY = b"synthetic-account-reference-key!!"


class AccountIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-account-")
        self.root = Path(self.temp.name) / "ViberPC"
        self.root.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def account(self, number=NUMBER):
        directory = self.root / number[1:]
        directory.mkdir()
        database = directory / "viber.db"
        database.write_bytes(b"synthetic-not-a-real-viber-db")
        return database

    def test_exact_expected_number_returns_only_opaque_refs(self):
        self.account()
        result = verify_layout(self.root, NUMBER, KEY)
        self.assertTrue(result["account_verified"])
        self.assertEqual(len(result["account_ref"]), 64)
        self.assertEqual(len(result["source_generation_ref"]), 64)
        self.assertFalse(result["account_value_exported"])
        self.assertFalse(result["database_opened"])
        self.assertNotIn(NUMBER[1:], repr(result))

    def test_wrong_number_fails_without_exporting_actual_value(self):
        self.account()
        with self.assertRaises(AccountIdentityError) as caught:
            verify_layout(self.root, "+380000000002", KEY)
        self.assertEqual(caught.exception.code, "ACCOUNT_IDENTITY_MISMATCH")
        self.assertNotIn(NUMBER[1:], str(caught.exception))

    def test_multiple_account_databases_fail_closed(self):
        self.account()
        self.account("+380000000002")
        with self.assertRaises(AccountIdentityError) as caught:
            verify_layout(self.root, NUMBER, KEY)
        self.assertEqual(caught.exception.code, "ACCOUNT_SOURCE_NOT_UNIQUE")

    def test_invalid_number_formats_are_not_normalized_heuristically(self):
        for value in ["380000000001", "+38 000 000 0001", "+038000000001", "", None]:
            with self.subTest(value=value), self.assertRaises(AccountIdentityError) as caught:
                verify_layout(self.root, value, KEY)
            self.assertEqual(caught.exception.code, "EXPECTED_ACCOUNT_INVALID")

    def test_unrelated_directories_are_ignored_but_account_db_must_exist(self):
        (self.root / "logs").mkdir()
        (self.root / "logs" / "viber.db").write_bytes(b"unrelated")
        with self.assertRaises(AccountIdentityError) as caught:
            verify_layout(self.root, NUMBER, KEY)
        self.assertEqual(caught.exception.code, "ACCOUNT_SOURCE_NOT_UNIQUE")
        self.account()
        self.assertTrue(verify_layout(self.root, NUMBER, KEY)["account_verified"])


if __name__ == "__main__":
    unittest.main()
