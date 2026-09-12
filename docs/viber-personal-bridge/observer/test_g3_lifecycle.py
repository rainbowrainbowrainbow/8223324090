"""Exercise the real G3 worker with synthetic SQLite and no Viber access."""

from contextlib import ExitStack
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import g3_journal
import g3_queries
import observe_g3


RUN_ID = "A1B2C3D4"
KEY = b"synthetic-test-reference-key-only!"
DUP = "EGXG3-" + RUN_ID + "-DUP"
NEW = "EGXG3-" + RUN_ID + "-NEW"


class SyntheticSource:
    """Qt-shaped connection over a test-owned, read-only SQLite file."""

    def __init__(self, path):
        self.connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True,
                                          isolation_level=None)
        self.transactions = 0
        self.rollbacks = 0
        self.closes = 0
        self.fail_read = False
        self.fail_close = False

    def transaction(self):
        self.transactions += 1
        self.connection.execute("BEGIN")
        return True

    def rollback(self):
        self.rollbacks += 1
        self.connection.rollback()
        return True

    def close(self):
        self.closes += 1
        self.connection.close()
        if self.fail_close:
            raise RuntimeError("synthetic close failure")

    def read_rows(self, sql, parameters, column_count, row_limit):
        if self.fail_read:
            raise observe_g3.ObserverError("SOURCE_QUERY_FAILED")
        cursor = self.connection.execute(sql, parameters)
        try:
            rows = cursor.fetchmany(row_limit + 1)
        finally:
            cursor.close()
        if len(rows) > row_limit or any(len(row) != column_count for row in rows):
            raise AssertionError("Synthetic adapter received an unexpected query shape")
        return rows


class SyntheticClock:
    def __init__(self, actions=None):
        self.now = 0.0
        self.sleeps = 0
        self.actions = actions or {}

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        self.sleeps += 1
        action = self.actions.get(self.sleeps)
        if action is not None:
            action()


class WorkerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-g3-lifecycle-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / "synthetic-source.sqlite"
        self.journal_file = self.directory / "synthetic-journal.sqlite"
        self.session_path = self.directory / "synthetic-session.json"
        self.writer = sqlite3.connect(self.source)
        self.addCleanup(self.writer.close)
        self.writer.executescript("""
            CREATE TABLE Events(EventID, ChatID, ContactID, TimeStamp, Direction);
            CREATE TABLE Messages(EventID, Body TEXT COLLATE NOCASE);
            CREATE TABLE Contact(ContactID, Number);
            CREATE TABLE ChatInfo(ChatID, Token);
        """)
        self.relations(20, 30)
        self.add_event(10, "synthetic baseline", 20, 30)
        self.claimed = False
        self.sources = []
        self.journals = []
        self.locks = []
        self.removed = Mock()
        self.context = SimpleNamespace(sql=SimpleNamespace(
            QSqlDatabase=SimpleNamespace(removeDatabase=self.removed)))
        self.fixture = SimpleNamespace(initialize_qt=Mock(return_value=self.context),
                                      run_fixture=Mock(return_value={"status": "PASS"}))
        self.schema = SimpleNamespace(collect_candidates=Mock(side_effect=lambda _probe:
            ([b"synthetic candidate"], False, {"target_verified": True, "status": "complete"})))
        self.process_alive = True
        self.process_guard = SimpleNamespace(alive=Mock(side_effect=lambda: self.process_alive), close=Mock())
        self.process_module = SimpleNamespace(capture=Mock(return_value=self.process_guard))
        self.state = SimpleNamespace(
            load_session=Mock(return_value={"run_id": RUN_ID, "hmac_key": KEY,
                                           "bindings_path": str(self.directory / "synthetic-bindings")}),
            claim_journal_initialization=Mock(side_effect=self.claim))
        self.module_map = {
            "g3_state": self.state,
            "qt_readonly_fixture": self.fixture,
            "probe_db_schema": self.schema,
            "probe_key_presence": SimpleNamespace(),
            "g3_process": self.process_module,
            "g3_journal": SimpleNamespace(Journal=self.open_journal),
            "g3_queries": g3_queries,
        }

    def claim(self, _path):
        first = not self.claimed
        self.claimed = True
        return self.journal_file, first

    def open_journal(self, *args):
        journal = g3_journal.Journal(*args)
        journal.close = Mock(wraps=journal.close)
        self.journals.append(journal)
        self.addCleanup(journal.close)
        return journal

    def open_source(self, _context, _fixture, _schema, path, _candidates):
        self.assertEqual(path, self.source)
        source = SyntheticSource(path)
        self.sources.append(source)
        self.addCleanup(source.connection.close)
        return source, "synthetic_connection_" + str(len(self.sources))

    def lock_session(self, _state, _path):
        lock = SimpleNamespace(close=Mock())
        self.locks.append(lock)
        return lock

    def relations(self, chat, contact):
        self.writer.execute("INSERT INTO Contact VALUES (?, ?)", (contact, "synthetic-number"))
        self.writer.execute("INSERT INTO ChatInfo VALUES (?, ?)", (chat, "synthetic-token"))
        self.writer.commit()

    def add_event(self, event_id, marker=DUP, chat=20, contact=30):
        self.writer.execute("INSERT INTO Events VALUES (?, ?, ?, ?, ?)",
                            (event_id, chat, contact, 1700000000000, 0))
        self.writer.execute("INSERT INTO Messages VALUES (?, ?)", (event_id, marker))
        self.writer.commit()

    def add_duplicates(self):
        self.add_event(11)
        self.add_event(12)

    def references(self):
        epoch = observe_g3.reference(KEY, "database-epoch", observe_g3.source_identity(self.source))
        account = observe_g3.reference(KEY, "local-account-directory",
                                       os.path.normcase(str(self.source.parent)))
        return epoch, account

    def persisted(self):
        with g3_journal.Journal(self.journal_file, *self.references()) as journal:
            return journal.snapshot(), journal.list_pending()

    def run_worker(self, seconds=0, *, local_ack=False, progress=None, should_stop=None,
                   actions=None, enforce_process_continuity=False, source_path=None, candidate_provider=None):
        clock = SyntheticClock(actions)
        with ExitStack() as patches:
            patches.enter_context(patch.object(observe_g3, "load_local",
                                                side_effect=self.module_map.__getitem__))
            patches.enter_context(patch.object(observe_g3, "source_path",
                                                side_effect=source_path or (lambda: self.source)))
            patches.enter_context(patch.object(observe_g3, "open_source", side_effect=self.open_source))
            patches.enter_context(patch.object(observe_g3, "lock_session", side_effect=self.lock_session))
            patches.enter_context(patch.object(observe_g3, "QtRows",
                                                side_effect=lambda _context, db: db.read_rows))
            patches.enter_context(patch.object(observe_g3, "time", clock))
            return observe_g3.worker(self.session_path, seconds, local_ack,
                                     progress=progress, should_stop=should_stop,
                                     redirect_stderr=False,
                                     enforce_process_continuity=enforce_process_continuity,
                                     candidate_provider=candidate_provider)

    def assert_closed_once(self, index=0):
        self.assertEqual(self.sources[index].closes, 1)
        self.assertEqual(self.journals[index].close.call_count, 1)
        self.assertEqual(self.locks[index].close.call_count, 1)
        self.assertEqual(self.removed.call_args_list[index].args,
                         ("synthetic_connection_" + str(index + 1),))

    def test_polling_keeps_one_source_and_one_candidate_scan(self):
        progress = []
        report = self.run_worker(3, progress=progress.append, actions={1: self.add_duplicates})
        self.assertEqual(report["status"], "TEST_MARKERS_OBSERVED")
        self.assertTrue(observe_g3.valid_public(report))
        self.assertEqual(len(self.sources), 1)
        self.assertEqual(self.schema.collect_candidates.call_count, 1)
        self.assertEqual(self.fixture.initialize_qt.call_count, 1)
        self.assertEqual(self.sources[0].transactions, 4)
        self.assertEqual(self.sources[0].rollbacks, 4)
        self.assertEqual([row["journal_pending"] for row in progress], [0, 2, 2, 2])
        self.assertEqual([row["case_counts"]["DUP"] for row in progress], [0, 2, 2, 2])
        self.assertEqual(report["newly_journaled"], 2)
        self.assertEqual(report["reobserved"], 4)
        self.assertTrue(report["same_chat_distinct_duplicate_events"])
        self.assert_closed_once()

    def test_progress_consumer_cannot_mutate_worker_or_other_snapshots(self):
        progress = []

        def consume(report):
            progress.append(report)
            report["case_counts"]["DUP"] = 999
            report["journal_pending"] = 999

        report = self.run_worker(1, progress=consume, actions={1: self.add_duplicates})
        self.assertEqual(report["journal_pending"], 2)
        self.assertEqual(report["case_counts"]["DUP"], 2)
        self.assertIsNot(progress[0], progress[1])
        self.assertIsNot(progress[0]["case_counts"], progress[1]["case_counts"])
        self.assertIsNot(progress[1]["case_counts"], report["case_counts"])
        self.assertTrue(observe_g3.valid_public(report))

    def test_stop_preserves_pending_without_ack_and_restart_reuses_baseline(self):
        stopped = False

        def consume(report):
            nonlocal stopped
            stopped = report["journal_pending"] == 2

        report = self.run_worker(30, local_ack=True, progress=consume,
                                 should_stop=lambda: stopped, actions={1: self.add_duplicates})
        self.assertEqual(report["polls"], 2)
        self.assertFalse(report["local_ack_simulation_performed"])
        before, pending = self.persisted()
        self.assertEqual(before, {"baseline": 10, "cursor": 12, "pending": 2, "acked": 0, "total": 2})
        self.assert_closed_once()
        restarted = self.run_worker()
        after, replay = self.persisted()
        self.assertTrue(restarted["baseline_reused"])
        self.assertEqual(restarted["newly_journaled"], 0)
        self.assertEqual(restarted["reobserved"], 2)
        self.assertEqual(after, before)
        self.assertEqual(replay, pending)
        self.assertEqual(self.schema.collect_candidates.call_count, 2)
        self.assert_closed_once(1)

    def test_late_hydration_is_found_behind_persisted_cursor(self):
        progress = []

        def add_unhydrated():
            self.add_event(11, NEW, 40, 50)
            self.add_event(12, "synthetic non-marker", 20, 30)

        report = self.run_worker(3, progress=progress.append,
                                 actions={1: add_unhydrated, 2: lambda: self.relations(40, 50)})
        self.assertEqual([row["journal_total"] for row in progress], [0, 0, 1, 1])
        self.assertEqual([row["pending_relations"] for row in progress], [0, 1, 0, 0])
        self.assertEqual(report["new_marker_without_prior_local_chat_events"], 1)
        snapshot, pending = self.persisted()
        self.assertEqual(snapshot["baseline"], 10)
        self.assertEqual(snapshot["cursor"], 12)
        self.assertEqual([row["source_event_id"] for row in pending], [11])
        self.assert_closed_once()

    def test_query_failure_rolls_back_closes_and_keeps_last_committed_pending(self):
        progress = []

        def consume(report):
            progress.append(report)
            if report["journal_pending"] == 2:
                self.sources[0].fail_read = True

        report = self.run_worker(30, local_ack=True, progress=consume,
                                 actions={1: self.add_duplicates})
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["error_code"], "SOURCE_QUERY_FAILED")
        self.assertTrue(observe_g3.valid_public(report))
        self.assertEqual(len(progress), 2)
        self.assertEqual(self.sources[0].transactions, 3)
        self.assertEqual(self.sources[0].rollbacks, 3)
        self.assertFalse(report["local_ack_simulation_performed"])
        self.assertEqual(self.persisted()[0]["pending"], 2)
        self.assert_closed_once()

    def test_stop_before_startup_acquires_nothing(self):
        progress = Mock()
        report = self.run_worker(30, local_ack=True, progress=progress, should_stop=lambda: True)
        self.assertEqual(report["status"], "NOT_RUN")
        self.assertEqual(report["polls"], 0)
        self.assertFalse(report["local_ack_simulation_performed"])
        self.assertEqual(self.sources, [])
        self.assertEqual(self.journals, [])
        self.assertEqual(self.locks, [])
        self.state.load_session.assert_not_called()
        self.schema.collect_candidates.assert_not_called()
        progress.assert_not_called()

    def test_cleanup_failure_still_releases_remaining_resources(self):
        def consume(_report):
            self.sources[0].fail_close = True

        report = self.run_worker(progress=consume)
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["error_code"], "CLEANUP_FAILED")
        self.assert_closed_once()

    def test_process_change_fails_closed_without_reacquisition_or_ack(self):
        progress = []

        def collect_candidates(_probe):
            self.process_module.capture.assert_called_once()
            return [b"synthetic candidate"], False, {"target_verified": True, "status": "complete"}

        def consume(report):
            progress.append(report)
            if report["journal_pending"] == 2:
                self.process_alive = False

        self.schema.collect_candidates.side_effect = collect_candidates
        report = self.run_worker(30, local_ack=True, progress=consume,
                                 actions={1: self.add_duplicates}, enforce_process_continuity=True)
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["error_code"], "SOURCE_TARGET_CHANGED")
        self.assertFalse(report["target_verified"])
        self.assertFalse(report["local_ack_simulation_performed"])
        self.assertTrue(observe_g3.valid_public(report))
        self.assertEqual(len(progress), 2)
        self.assertTrue(all(row["target_verified"] for row in progress))
        self.process_module.capture.assert_called_once_with(self.module_map["probe_key_presence"])
        self.process_guard.close.assert_called_once()
        self.assertEqual(self.schema.collect_candidates.call_count, 1)
        self.assertEqual(len(self.sources), 1)
        self.assertEqual(self.sources[0].transactions, 2)
        self.assertEqual(self.persisted()[0]["pending"], 2)
        self.assert_closed_once()

    def test_account_path_change_fails_closed_even_when_process_stays_alive(self):
        current_path = self.source
        pending_before_change = []

        def consume(report):
            nonlocal current_path
            if report["journal_pending"] == 2:
                pending_before_change.extend(self.journals[0].list_pending())
                current_path = self.directory / "synthetic-other-account.sqlite"

        report = self.run_worker(30, local_ack=True, progress=consume,
                                 actions={1: self.add_duplicates}, enforce_process_continuity=True,
                                 source_path=lambda: current_path)
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["error_code"], "SOURCE_EPOCH_CHANGED")
        self.assertFalse(report["source_file_continuity_verified"])
        self.assertTrue(report["target_verified"])
        self.assertTrue(self.process_alive)
        self.assertTrue(observe_g3.valid_public(report))
        self.assertFalse(report["local_ack_simulation_performed"])
        self.assertEqual(report["polls"], 2)
        self.assertEqual(len(self.sources), 1)
        self.assertEqual(self.sources[0].transactions, 2)
        self.assertEqual(self.schema.collect_candidates.call_count, 1)
        self.process_module.capture.assert_called_once()
        self.process_guard.close.assert_called_once()
        snapshot, pending = self.persisted()
        self.assertEqual(snapshot, {"baseline": 10, "cursor": 12, "pending": 2, "acked": 0, "total": 2})
        self.assertEqual(pending, pending_before_change)
        self.assert_closed_once()


if __name__ == "__main__":
    unittest.main()
