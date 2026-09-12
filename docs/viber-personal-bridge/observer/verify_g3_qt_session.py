"""Manual synthetic-only Qt session check; run in a disposable timed process.

Requires the previously verified bindings directory. Uses the installed,
hash-pinned Viber SQL plugin, but opens no Viber account, process or key.
"""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from g3_journal import Journal
from g3_queries import scan_window
from observe_g3 import QtRows, reference
import qt_readonly_fixture as fixture


def verify(bindings):
    context = fixture.initialize_qt(bindings)
    if fixture.run_fixture(context)["status"] != "PASS":
        raise RuntimeError("SYNTHETIC_PREREQUISITE_FAILED")
    marker = "EGXG3-A1B2C3D4-DUP"
    key = b"synthetic-qt-reference-only-key!!"
    epoch, account = reference(key, "epoch", 1), reference(key, "account", 1)
    with tempfile.TemporaryDirectory(prefix="eventgenix-g3-qt-synthetic-") as temporary:
        source = Path(temporary) / "synthetic-source.sqlite"
        state = Path(temporary) / "synthetic-journal.sqlite"
        with closing(sqlite3.connect(source)) as writer:
            writer.executescript("""
                CREATE TABLE Events(EventID, ChatID, ContactID, TimeStamp, Direction);
                CREATE TABLE Messages(EventID, Body TEXT);
                CREATE TABLE Contact(ContactID, Number);
                CREATE TABLE ChatInfo(ChatID, Token);
                INSERT INTO Events VALUES (10,20,30,1700000000000,0);
                INSERT INTO Contact VALUES (30,'synthetic-number');
                INSERT INTO ChatInfo VALUES (20,'synthetic-token');
            """)
            db = rows = None
            name = "eventgenix_g3_synthetic_session"
            try:
                db = fixture._readonly_connection(context, name, source)
                if not db.open():
                    raise RuntimeError("SYNTHETIC_SOURCE_OPEN_FAILED")
                rows = QtRows(context, db)
                with Journal(state, epoch, account) as journal:
                    baseline = journal.initialize_baseline(rows("SELECT MAX(EventID) FROM Events", {}, 1, 1)[0][0])
                    applied = []
                    for poll in range(3):
                        if not db.transaction():
                            raise RuntimeError("SYNTHETIC_TRANSACTION_FAILED")
                        try:
                            window = scan_window(rows, baseline, [marker])
                        finally:
                            if not db.rollback():
                                raise RuntimeError("SYNTHETIC_ROLLBACK_FAILED")
                        events = [{"source_event_id": row["source_event_id"],
                                   "chat_ref": reference(key, "chat", row["chat_id"]),
                                   "peer_ref": reference(key, "contact", row["contact_id"]),
                                   "marker": row["marker"], "direction_code": row["direction_code"]}
                                  for row in window["observations"]]
                        applied.append(journal.observe_batch(events, window["cursor"]))
                        if poll == 0:
                            writer.executemany("INSERT INTO Events VALUES (?,20,30,1700000000000,0)", [(11,), (12,)])
                            writer.executemany("INSERT INTO Messages VALUES (?,?)", [(11, marker), (12, marker)])
                            writer.commit()
                    pending = journal.list_pending()
                    if [row["inserted"] for row in applied] != [0, 2, 0] or applied[2]["existing"] != 2:
                        raise RuntimeError("SYNTHETIC_POLL_RESULTS_FAILED")
            finally:
                rows = None
                if db is not None:
                    db.close()
                db = None
                context.sql.QSqlDatabase.removeDatabase(name)
            with Journal(state, epoch, account) as reopened:
                if reopened.snapshot() != {"baseline": 10, "cursor": 12, "pending": 2, "acked": 0, "total": 2}:
                    raise RuntimeError("SYNTHETIC_DURABILITY_FAILED")
                if reopened.list_pending() != pending or pending[0]["event_id"] == pending[1]["event_id"]:
                    raise RuntimeError("SYNTHETIC_EVENT_ID_FAILED")
    return {"scope": "SYNTHETIC_ONLY", "status": "PASS", "readonly_fixture_passed": True,
            "session_source_connections": 1, "polls": 3, "distinct_duplicate_events": 2,
            "replay_deduplicated": True, "pending_durable_after_reopen": 2,
            "private_database_opened": False, "viber_process_accessed": False,
            "account_keys_used": False, "messages_sent": 0}


if __name__ == "__main__":
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--bindings", required=True)
        result = verify(parser.parse_args().bindings)
    except BaseException:
        result = {"scope": "SYNTHETIC_ONLY", "status": "FAIL", "error_code": "SYNTHETIC_QT_SESSION_FAILED"}
    print(json.dumps(result, separators=(",", ":")), flush=True)
    raise SystemExit(0 if result["status"] == "PASS" else 1)
