"""Live inbound adapter tests; synthetic SQLite only, no real Viber account."""

from pathlib import Path
import sqlite3
import tempfile
import unittest

from p1_bridge_core import BridgeCore
from p1_live_inbound import (
    LiveInboundAdapter,
    LiveInboundError,
    LiveInboundJournal,
    SqliteReadOnlySource,
    resolve_anchor_after_baseline,
)


BRIDGE_ID = "11111111-1111-4111-8111-111111111111"
ACCOUNT_ID = "22222222-2222-4222-8222-222222222222"
KEY = b"0123456789abcdef0123456789abcdef"
PHONE = "EGXG3-0B038E78-PHONE"
DESKTOP = "EGXG3-0B038E78-DESKTOP"


def init_source(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE Events(EventID INTEGER PRIMARY KEY, ChatID INTEGER, ContactID INTEGER, Direction INTEGER)")
    db.execute("CREATE TABLE Messages(EventID INTEGER PRIMARY KEY, Body TEXT)")
    db.commit()
    return db


def add_message(db: sqlite3.Connection, event_id: int, chat_id: int, contact_id: int,
                direction: int, text: str) -> None:
    db.execute("INSERT INTO Events(EventID, ChatID, ContactID, Direction) VALUES(?, ?, ?, ?)",
               (event_id, chat_id, contact_id, direction))
    db.execute("INSERT INTO Messages(EventID, Body) VALUES(?, ?)", (event_id, text))
    db.commit()


class LiveInboundAdapterTests(unittest.TestCase):
    def make_core(self, root: Path) -> BridgeCore:
        return BridgeCore(root / "p1.sqlite", bridge_id=BRIDGE_ID, account_id=ACCOUNT_ID,
                          account_epoch=1, business_context="dar")

    def make_adapter(self, root: Path, source_path: Path, *, source_identity: str = "fixture-db"):
        source = SqliteReadOnlySource(source_path)
        source.open()
        journal = LiveInboundJournal(root / "capture.sqlite")
        adapter = LiveInboundAdapter(
            journal=journal,
            reader=source.read_rows,
            reference_key=KEY,
            phone_marker=PHONE,
            desktop_marker=DESKTOP,
            account_identity=ACCOUNT_ID,
            source_identity=source_identity,
            source_handle=source,
        )
        return adapter

    def test_enrollment_captures_text_variants_and_restart_does_not_duplicate_after_ack(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_path = root / "viber.sqlite"
            db = init_source(source_path)
            add_message(db, 1, 20, 30, 0, PHONE)
            add_message(db, 2, 20, 40, 1, DESKTOP)
            core = self.make_core(root)
            adapter = self.make_adapter(root, source_path)
            try:
                waiting = adapter.scan_once(core)
                self.assertFalse(waiting["receive_text"])
                add_message(db, 10, 20, 30, 0, PHONE)
                add_message(db, 11, 20, 40, 1, DESKTOP)
                add_message(db, 12, 20, 30, 0, "Перший текст")
                add_message(db, 13, 20, 30, 0, "same")
                add_message(db, 14, 20, 30, 0, "same")
                add_message(db, 15, 20, 30, 0, "emoji 🙂🔥")
                add_message(db, 16, 20, 30, 0, "line 1\nline 2")
                result = adapter.scan_once(core)
                self.assertTrue(result["receive_text"])
                self.assertEqual(result["captured"], 5)
                pending = core.list_pending_events()
                self.assertEqual([event["text"] for event in pending], [
                    "Перший текст", "same", "same", "emoji 🙂🔥", "line 1\nline 2",
                ])
                self.assertEqual(len({event["source_event_ref"] for event in pending}), 5)
                core.ack_events([event["event_id"] for event in pending])
            finally:
                adapter.close()
                core.close()
                db.close()

            db = sqlite3.connect(source_path)
            core = self.make_core(root)
            adapter = self.make_adapter(root, source_path)
            try:
                result = adapter.scan_once(core)
                self.assertTrue(result["receive_text"])
                self.assertEqual(result["captured"], 0)
                self.assertEqual(core.list_pending_events(), [])
                self.assertEqual(core.diagnostics()["inbound_acked"], 5)
            finally:
                adapter.close()
                core.close()
                db.close()

    def test_pending_journal_event_imports_after_restart_before_rescan(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_path = root / "viber.sqlite"
            db = init_source(source_path)
            core = self.make_core(root)
            adapter = self.make_adapter(root, source_path)
            try:
                adapter.scan_once(core)
                add_message(db, 10, 20, 30, 0, PHONE)
                add_message(db, 11, 20, 40, 1, DESKTOP)
                adapter.scan_once(core)
                add_message(db, 12, 20, 30, 0, "survives restart")
                rows = [{"source_event_id": 12, "text": "survives restart"}]
                state = adapter.journal.state()
                adapter.journal.capture_events(rows, reference_key=KEY,
                                               source_chat_ref_value=state["source_chat_ref"],
                                               peer_ref_value=state["peer_ref"])
                self.assertEqual(core.list_pending_events(), [])
            finally:
                adapter.close()
                core.close()
                db.close()

            db = sqlite3.connect(source_path)
            core = self.make_core(root)
            adapter = self.make_adapter(root, source_path)
            try:
                result = adapter.scan_once(core)
                self.assertTrue(result["receive_text"])
                self.assertEqual(result["imported"], 1)
                self.assertEqual([event["text"] for event in core.list_pending_events()], ["survives restart"])
            finally:
                adapter.close()
                core.close()
                db.close()

    def test_peer_change_blocks_capture(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_path = root / "viber.sqlite"
            db = init_source(source_path)
            core = self.make_core(root)
            adapter = self.make_adapter(root, source_path)
            try:
                adapter.scan_once(core)
                add_message(db, 10, 20, 30, 0, PHONE)
                add_message(db, 11, 20, 40, 1, DESKTOP)
                self.assertTrue(adapter.scan_once(core)["receive_text"])
                add_message(db, 12, 20, 31, 0, "wrong peer")
                result = adapter.scan_once(core)
                self.assertFalse(result["receive_text"])
                self.assertEqual(result["block_reason"], "PAIRED_IDENTITY_CHANGED")
            finally:
                adapter.close()
                core.close()
                db.close()

    def test_source_change_blocks_capture(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_path = root / "viber.sqlite"
            db = init_source(source_path)
            core = self.make_core(root)
            adapter = self.make_adapter(root, source_path)
            try:
                adapter.scan_once(core)
                add_message(db, 10, 20, 30, 0, PHONE)
                add_message(db, 11, 20, 40, 1, DESKTOP)
                self.assertTrue(adapter.scan_once(core)["receive_text"])
            finally:
                adapter.close()
                core.close()
                db.close()

            core = self.make_core(root)
            adapter = self.make_adapter(root, source_path, source_identity="different-db")
            try:
                result = adapter.scan_once(core)
                self.assertFalse(result["receive_text"])
                self.assertEqual(result["block_reason"], "SOURCE_DB_CHANGED")
            finally:
                adapter.close()
                core.close()


    def test_journal_loss_and_schema_change_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal_path = root / "capture.sqlite"
            journal = LiveInboundJournal(journal_path)
            journal.close()
            self.assertTrue((root / "capture.sqlite.meta").exists())
            journal_path.unlink()
            with self.assertRaises(LiveInboundError) as caught:
                LiveInboundJournal(journal_path)
            self.assertEqual(caught.exception.code, "JOURNAL_LOST")

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal_path = root / "capture.sqlite"
            db = sqlite3.connect(journal_path)
            db.execute("CREATE TABLE unexpected(id INTEGER PRIMARY KEY)")
            db.commit()
            db.close()
            with self.assertRaises(LiveInboundError) as caught:
                LiveInboundJournal(journal_path)
            self.assertEqual(caught.exception.code, "JOURNAL_SCHEMA_MISMATCH")

    def test_anchor_resolution_ignores_markers_before_baseline(self):
        calls = []

        def reader(sql, params, columns, limit):
            calls.append((sql, params, columns, limit))
            if params["marker"].endswith("-PHONE"):
                return [(10, 20, 30, 0)]
            return [(11, 20, 40, 1)]

        anchor = resolve_anchor_after_baseline(reader, PHONE, DESKTOP, 5)
        self.assertEqual(anchor["anchor_event_id"], 11)
        self.assertTrue(all(call[1]["after_event_id"] == 5 for call in calls))


if __name__ == "__main__":
    unittest.main()
