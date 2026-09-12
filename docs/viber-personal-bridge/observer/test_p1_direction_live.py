"""Synthetic tests for the controlled live direction verifier."""

from pathlib import Path
import sqlite3
import tempfile
import unittest

import g3_journal
from verify_p1_direction_live import verify


class DirectionLiveVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-direction-")
        self.path = Path(self.temp.name) / "journal.sqlite"

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self, phone=0, desktop=1, same_chat=True):
        db = sqlite3.connect(self.path)
        db.executescript("""
            CREATE TABLE source_state(id INTEGER PRIMARY KEY);
            CREATE TABLE events(marker TEXT, direction_code INTEGER, chat_ref TEXT);
        """)
        db.execute(f"PRAGMA application_id={g3_journal.APPLICATION_ID}")
        db.execute(f"PRAGMA user_version={g3_journal.SCHEMA_VERSION}")
        db.execute("INSERT INTO events VALUES(?, ?, ?)",
                   ("EGXG3-0B038E78-PHONE", phone, "chat-a"))
        db.execute("INSERT INTO events VALUES(?, ?, ?)",
                   ("EGXG3-0B038E78-DESKTOP", desktop, "chat-a" if same_chat else "chat-b"))
        db.commit()
        db.close()

    def verify(self):
        return verify("synthetic", session_loader=lambda _session: {"run_id": "0B038E78"},
                      path_provider=lambda _session: self.path)

    def test_distinct_codes_in_same_chat_are_redacted_and_verified(self):
        self.prepare()
        result = self.verify()
        self.assertEqual(result["status"], "DIRECTION_VERIFIED")
        self.assertTrue(result["direction_verified"])
        self.assertEqual((result["inbound_code"], result["outbound_code"]), (0, 1))
        self.assertNotIn("chat-a", repr(result))

    def test_equal_codes_or_different_chat_fail_closed(self):
        for equal, same_chat in ((True, True), (False, False)):
            with self.subTest(equal=equal, same_chat=same_chat):
                if self.path.exists():
                    self.path.unlink()
                self.prepare(phone=0, desktop=0 if equal else 1, same_chat=same_chat)
                result = self.verify()
                self.assertEqual(result["status"], "DIRECTION_NOT_VERIFIED")
                self.assertFalse(result["direction_verified"])

    def test_wrong_schema_is_rejected(self):
        sqlite3.connect(self.path).close()
        result = self.verify()
        self.assertEqual(result["error_code"], "JOURNAL_INVALID")


if __name__ == "__main__":
    unittest.main()
