"""Synthetic-only journal checks; all SQLite state lives in OS temporary dirs."""

from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from g3_journal import EventConflict, EpochMismatch, Journal, JournalError


EPOCH = "hmac:" + "a" * 64
ACCOUNT = "hmac:" + "b" * 64
CHAT = "hmac:" + "c" * 64
PEER = "hmac:" + "d" * 64


def event(source_event_id=11, **changes):
    row = {"source_event_id": source_event_id, "chat_ref": CHAT, "peer_ref": PEER,
           "marker": "EGXG3-A1B2C3D4-DUP", "direction_code": 0}
    row.update(changes)
    return row


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-g3-synthetic-")
        self.path = Path(self.temp.name) / "journal.sqlite"
        self.journal = Journal(self.path, EPOCH, ACCOUNT)

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def baseline(self):
        self.assertEqual(self.journal.initialize_baseline(10), 10)

    def test_baseline_initialized_once_and_survives_file_reopen(self):
        self.baseline()
        self.journal.observe_batch([event()], 15)
        self.journal.close()
        self.journal = Journal(self.path, EPOCH, ACCOUNT)
        self.assertEqual(self.journal.initialize_baseline(900), 10)
        self.assertEqual(self.journal.snapshot(), {"baseline": 10, "cursor": 15, "pending": 1, "acked": 0, "total": 1})

    def test_different_ids_preserve_two_identical_markers(self):
        self.baseline()
        result = self.journal.observe_batch([event(11), event(12)], 12)
        self.assertEqual(result["inserted"], 2)
        pending = self.journal.list_pending()
        self.assertEqual(len(pending), 2)
        self.assertNotEqual(pending[0]["event_id"], pending[1]["event_id"])
        self.assertEqual(pending[0]["marker"], pending[1]["marker"])

    def test_reobserve_same_event_keeps_stable_delivery_id(self):
        self.baseline()
        self.journal.observe_batch([event()], 11)
        first = self.journal.list_pending()
        self.assertEqual(self.journal.observe_batch([event(), event()], 11)["existing"], 2)
        self.assertEqual(self.journal.list_pending(), first)

    def test_every_changed_immutable_field_conflicts_and_rolls_back_batch(self):
        self.baseline()
        self.journal.observe_batch([event()], 11)
        for field, value in {"chat_ref": "hmac:" + "e" * 64, "peer_ref": "hmac:" + "f" * 64,
                             "marker": "EGXG3-A1B2C3D4-NEW", "direction_code": 1}.items():
            with self.subTest(field=field), self.assertRaises(EventConflict):
                self.journal.observe_batch([event(12), event(**{field: value})], 25)
            self.assertEqual(self.journal.snapshot()["cursor"], 11)
            self.assertEqual(self.journal.snapshot()["total"], 1)

    def test_unknown_direction_becoming_known_is_explicit_conflict(self):
        self.baseline()
        self.journal.observe_batch([event(direction_code=None)], 11)
        with self.assertRaises(EventConflict):
            self.journal.observe_batch([event(direction_code=0)], 11)

    def test_new_contact_needs_no_name_allowlist(self):
        self.baseline()
        self.journal.observe_batch([event(peer_ref="hmac:" + "f" * 64, chat_ref="hmac:" + "e" * 64,
                                          marker="EGXG3-A1B2C3D4-NEW")], 11)
        self.assertEqual(self.journal.snapshot()["total"], 1)

    def test_late_marker_below_cursor_is_stored_without_cursor_regression(self):
        self.baseline()
        self.journal.observe_batch([], 100)
        result = self.journal.observe_batch([event(12)], 15)
        self.assertEqual(result["inserted"], 1)
        self.assertEqual(result["cursor"], 100)

    def test_ack_is_durable_idempotent_and_reobserve_does_not_requeue(self):
        self.baseline()
        self.journal.observe_batch([event()], 11)
        event_id = self.journal.list_pending()[0]["event_id"]
        self.assertEqual(self.journal.ack([event_id, event_id]), 1)
        self.journal.close()
        self.journal = Journal(self.path, EPOCH, ACCOUNT)
        self.assertEqual(self.journal.ack([event_id]), 0)
        self.journal.observe_batch([event()], 11)
        self.assertEqual(self.journal.list_pending(), [])
        self.assertEqual(self.journal.snapshot()["acked"], 1)

    def test_unknown_ack_aborts_all_ack_changes(self):
        self.baseline()
        self.journal.observe_batch([event()], 11)
        event_id = self.journal.list_pending()[0]["event_id"]
        with self.assertRaises(JournalError) as caught:
            self.journal.ack([event_id, "evt_" + "0" * 32])
        self.assertEqual(caught.exception.code, "ACK_EVENT_UNKNOWN")
        self.assertEqual(self.journal.snapshot()["pending"], 1)

    def test_changed_epoch_or_account_fails_closed(self):
        self.baseline()
        self.journal.close()
        for epoch, account in [("hmac:" + "e" * 64, ACCOUNT), (EPOCH, "hmac:" + "f" * 64)]:
            with self.subTest(epoch=epoch), self.assertRaises(EpochMismatch):
                Journal(self.path, epoch, account)
        self.journal = Journal(self.path, EPOCH, ACCOUNT)
        self.assertEqual(self.journal.snapshot()["baseline"], 10)

    def test_prebaseline_or_uninitialized_events_are_rejected(self):
        with self.assertRaises(JournalError) as caught:
            self.journal.observe_batch([event()], 11)
        self.assertEqual(caught.exception.code, "BASELINE_REQUIRED")
        self.baseline()
        with self.assertRaises(JournalError):
            self.journal.observe_batch([event(10)], 11)
        with self.assertRaises(JournalError):
            self.journal.observe_batch([event(12)], 11)
        self.assertEqual(self.journal.snapshot()["total"], 0)

    def test_privacy_allowlist_rejects_body_phone_names_and_uncontrolled_markers(self):
        self.baseline()
        forbidden = [event(body="synthetic-private-body"), event(phone="synthetic-phone"),
                     event(name="synthetic-name"), event(marker="uncontrolled-message"),
                     event(marker="EGXG3-A1B2C3D4-OTHER"), event(marker="EGXG3-a1b2c3d4-DUP"),
                     event(chat_ref="synthetic-name"), event(peer_ref="raw-contact"),
                     event(direction_code=True), event(source_event_id=True)]
        for row in forbidden:
            with self.subTest(fields=list(row)), self.assertRaises(JournalError):
                self.journal.observe_batch([row], 11)
        self.assertEqual(self.journal.snapshot()["total"], 0)
        stored = self.path.read_bytes()
        for forbidden_value in (b"synthetic-private-body", b"synthetic-phone", b"synthetic-name", b"uncontrolled-message"):
            self.assertNotIn(forbidden_value, stored)

    def test_process_crash_before_commit_preserves_previous_cursor_and_events(self):
        self.baseline()
        self.journal.observe_batch([event()], 11)
        self.journal.close()
        script = """
import os, sys
from g3_journal import Journal
j = Journal(sys.argv[1], sys.argv[2], sys.argv[3])
j._connection.set_trace_callback(lambda sql: os._exit(77) if sql == 'COMMIT' else None)
j.observe_batch([{'source_event_id':12,'chat_ref':sys.argv[4],'peer_ref':sys.argv[5],
                 'marker':'EGXG3-A1B2C3D4-DUP','direction_code':0}], 100)
"""
        result = subprocess.run([sys.executable, "-B", "-c", script, str(self.path), EPOCH, ACCOUNT, CHAT, PEER],
                                cwd=Path(__file__).parent, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 77)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"")
        self.journal = Journal(self.path, EPOCH, ACCOUNT)
        self.assertEqual(self.journal.snapshot(), {"baseline": 10, "cursor": 11, "pending": 1, "acked": 0, "total": 1})
        self.assertEqual(self.journal.observe_batch([event(12)], 100)["inserted"], 1)

    def test_concurrent_journal_instances_share_one_baseline_and_dedup(self):
        with Journal(self.path, EPOCH, ACCOUNT) as second:
            self.assertEqual(second.initialize_baseline(10), 10)
            self.assertEqual(self.journal.initialize_baseline(50), 10)
            second.observe_batch([event()], 11)
            self.assertEqual(self.journal.observe_batch([event()], 11)["inserted"], 0)

    def test_foreign_database_is_not_modified(self):
        foreign = Path(self.temp.name) / "foreign.sqlite"
        with closing(sqlite3.connect(foreign)) as db:
            with db:
                db.execute("CREATE TABLE unrelated(value TEXT)")
                db.execute("INSERT INTO unrelated VALUES ('synthetic')")
        before = foreign.read_bytes()
        with self.assertRaises(JournalError):
            Journal(foreign, EPOCH, ACCOUNT)
        self.assertEqual(foreign.read_bytes(), before)

    def test_state_inside_repository_is_rejected_before_file_creation(self):
        inside = Path(__file__).parent / "must-not-be-created.sqlite"
        self.assertFalse(inside.exists())
        with self.assertRaises(JournalError) as caught:
            Journal(inside, EPOCH, ACCOUNT)
        self.assertEqual(caught.exception.code, "STATE_INSIDE_REPOSITORY")
        self.assertFalse(inside.exists())


if __name__ == "__main__":
    unittest.main()
