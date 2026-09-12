"""One synthetic encrypted SEE fixture; requires an external process timeout.

Uses the already installed, hash-pinned SQL plugin through verified Qt bindings.
No account paths, Viber process access, real keys, arbitrary SQL or DB path CLI.
Deleting Python key references does not establish secure erasure or key absence.
"""

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile

from g3_journal import Journal
from g3_queries import scan_window
from observe_g3 import QtRows, reference
import qt_readonly_fixture as fixture


TEMP_PREFIX = "eventgenix-g3-see-synthetic-"
WRITER_NAME = "eventgenix_g3_see_synthetic_writer"
READER_NAME = "eventgenix_g3_see_synthetic_reader"
KEYLESS_NAME = "eventgenix_g3_see_synthetic_keyless"
ERROR_CODES = frozenset({
    "SYNTHETIC_ARGUMENTS", "SYNTHETIC_TEMP_GUARD_FAILED",
    "SYNTHETIC_WRITER_OPEN_FAILED", "SYNTHETIC_KEY_SUBMISSION_FAILED",
    "SYNTHETIC_CODEC_UNCONFIRMED", "SYNTHETIC_SQL_FAILED",
    "SYNTHETIC_TRANSACTION_FAILED", "SYNTHETIC_COMMIT_FAILED",
    "SYNTHETIC_READER_OPEN_FAILED", "SYNTHETIC_BASELINE_FAILED",
    "SYNTHETIC_READONLY_CREATE_FAILED", "SYNTHETIC_HEADER_FAILED",
    "SYNTHETIC_KEYLESS_READ_FAILED", "SYNTHETIC_ROLLBACK_FAILED",
    "SYNTHETIC_POLL_RESULTS_FAILED", "SYNTHETIC_DURABILITY_FAILED",
    "SYNTHETIC_EVENT_ID_FAILED", "SYNTHETIC_SEE_SESSION_FAILED",
    "SYNTHETIC_WAL_MODE_FAILED", "SYNTHETIC_WAL_SIDECARS_FAILED",
})


class SyntheticFailure(Exception):
    def __init__(self, code):
        self.code = code if code in ERROR_CODES else "SYNTHETIC_SEE_SESSION_FAILED"
        super().__init__(self.code)


def _guard_temp(path, temp_root):
    resolved = path.resolve(strict=True)
    if (resolved.parent != temp_root or not resolved.name.startswith(TEMP_PREFIX)
            or not resolved.is_dir() or path.is_symlink()
            or getattr(path, "is_junction", lambda: False)()):
        raise SyntheticFailure("SYNTHETIC_TEMP_GUARD_FAILED")
    return resolved


def _base_error(query):
    value = query.lastError().nativeErrorCode()
    return int(value) & 255 if value.isdecimal() and len(value) < 10 else 0


def _exec(context, db, sql, parameters=None):
    query = context.sql.QSqlQuery(db)
    try:
        if parameters is None:
            okay = query.exec(sql)
        else:
            okay = query.prepare(sql)
            if okay:
                for name, value in parameters.items():
                    query.bindValue(":" + name, value)
                okay = query.exec()
        if not okay:
            raise SyntheticFailure("SYNTHETIC_SQL_FAILED")
    finally:
        query.finish()


def _supply_synthetic_key(context, db, key_hex):
    # The only key input is generated inside verify(). No key enters argv,
    # environment variables, reports or fixture files as an explicit key value.
    query = context.sql.QSqlQuery(db)
    statement = "PRAGMA hexkey='" + key_hex + "'"
    try:
        if not query.exec(statement):
            raise SyntheticFailure("SYNTHETIC_KEY_SUBMISSION_FAILED")
    finally:
        query.finish()
        query = None
        statement = None


def _verify_readonly_create(context, db):
    query = context.sql.QSqlQuery(db)
    try:
        if query.exec("CREATE TABLE forbidden_synthetic_write (id INTEGER)"):
            raise SyntheticFailure("SYNTHETIC_READONLY_CREATE_FAILED")
        if _base_error(query) != 8:
            raise SyntheticFailure("SYNTHETIC_READONLY_CREATE_FAILED")
    finally:
        query.finish()


def _verify_keyless_read(context, source):
    db = query = None
    try:
        db = fixture._readonly_connection(context, KEYLESS_NAME, source)
        if not db.open():
            raise SyntheticFailure("SYNTHETIC_KEYLESS_READ_FAILED")
        query = context.sql.QSqlQuery(db)
        executed = query.exec("SELECT COUNT(*) FROM sqlite_master")
        if executed:
            # Some drivers surface read errors at first fetch rather than exec.
            if query.next():
                raise SyntheticFailure("SYNTHETIC_KEYLESS_READ_FAILED")
        if not query.lastError().isValid() or _base_error(query) != 26:
            raise SyntheticFailure("SYNTHETIC_KEYLESS_READ_FAILED")
    finally:
        if query is not None:
            query.finish()
        query = None
        if db is not None:
            db.close()
        db = None
        context.sql.QSqlDatabase.removeDatabase(KEYLESS_NAME)


def _insert_duplicates(context, writer, marker):
    if not writer.transaction():
        raise SyntheticFailure("SYNTHETIC_TRANSACTION_FAILED")
    try:
        for event_id in (11, 12):
            _exec(context, writer,
                  "INSERT INTO Events VALUES (:event_id,20,30,1700000000000,0)",
                  {"event_id": event_id})
            _exec(context, writer, "INSERT INTO Messages VALUES (:event_id,:marker)",
                  {"event_id": event_id, "marker": marker})
        if not writer.commit():
            raise SyntheticFailure("SYNTHETIC_COMMIT_FAILED")
    except BaseException:
        writer.rollback()
        raise


def verify(bindings):
    context = fixture.initialize_qt(bindings)
    temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
    temporary = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX, dir=temp_root))
    writer = reader = rows = None
    synthetic_key_hex = None
    try:
        owned = _guard_temp(temporary, temp_root)
        source = owned / "synthetic-encrypted-source.sqlite"
        state = owned / "synthetic-journal.sqlite"
        if source.exists() or state.exists():
            raise SyntheticFailure("SYNTHETIC_TEMP_GUARD_FAILED")
        marker = "EGXG3-A1B2C3D4-DUP"
        # Independent, non-secret HMAC seed for synthetic journal identities.
        reference_seed = b"synthetic-see-journal-reference-only"
        epoch = reference(reference_seed, "epoch", 1)
        account = reference(reference_seed, "account", 1)

        writer = context.sql.QSqlDatabase.addDatabase("QSQLITE", WRITER_NAME)
        fixture.check_plugin_loaded(context)
        if not writer.isValid():
            raise SyntheticFailure("SYNTHETIC_WRITER_OPEN_FAILED")
        writer.setConnectOptions("QSQLITE_BUSY_TIMEOUT=1000")
        writer.setDatabaseName(str(source))
        if not writer.open():
            raise SyntheticFailure("SYNTHETIC_WRITER_OPEN_FAILED")
        synthetic_key_hex = secrets.token_hex(32)
        _supply_synthetic_key(context, writer, synthetic_key_hex)
        options = QtRows(context, writer)("PRAGMA compile_options", {}, 1, 512)
        if not any(row == ("CODEC=see",) for row in options):
            raise SyntheticFailure("SYNTHETIC_CODEC_UNCONFIRMED")
        if QtRows(context, writer)("PRAGMA journal_mode=WAL", {}, 1, 1) != [("wal",)]:
            raise SyntheticFailure("SYNTHETIC_WAL_MODE_FAILED")
        if not writer.transaction():
            raise SyntheticFailure("SYNTHETIC_TRANSACTION_FAILED")
        try:
            for sql in (
                "CREATE TABLE Events(EventID, ChatID, ContactID, TimeStamp, Direction)",
                "CREATE TABLE Messages(EventID, Body TEXT)",
                "CREATE TABLE Contact(ContactID, Number)",
                "CREATE TABLE ChatInfo(ChatID, Token)",
                "INSERT INTO Events VALUES (10,20,30,1700000000000,0)",
                "INSERT INTO Contact VALUES (30,'synthetic-number')",
                "INSERT INTO ChatInfo VALUES (20,'synthetic-token')",
            ):
                _exec(context, writer, sql)
            if not writer.commit():
                raise SyntheticFailure("SYNTHETIC_COMMIT_FAILED")
        except BaseException:
            writer.rollback()
            raise

        if not all(Path(str(source) + suffix).is_file() for suffix in ("-wal", "-shm")):
            raise SyntheticFailure("SYNTHETIC_WAL_SIDECARS_FAILED")
        reader = fixture._readonly_connection(context, READER_NAME, source)
        if not reader.open():
            raise SyntheticFailure("SYNTHETIC_READER_OPEN_FAILED")
        _supply_synthetic_key(context, reader, synthetic_key_hex)
        # Drop our application references before all three polls. Qt/SEE and
        # allocator copies may still exist; this does not prove key absence.
        synthetic_key_hex = None
        rows = QtRows(context, reader)
        if rows("SELECT MAX(EventID) FROM Events", {}, 1, 1) != [(10,)]:
            raise SyntheticFailure("SYNTHETIC_BASELINE_FAILED")
        _verify_readonly_create(context, reader)
        with source.open("rb") as stream:
            header = stream.read(16)
        if len(header) != 16 or header == b"SQLite format 3\x00":
            raise SyntheticFailure("SYNTHETIC_HEADER_FAILED")
        _verify_keyless_read(context, source)

        with Journal(state, epoch, account) as journal:
            baseline = journal.initialize_baseline(10)
            applied = []
            for poll in range(3):
                if not reader.transaction():
                    raise SyntheticFailure("SYNTHETIC_TRANSACTION_FAILED")
                try:
                    window = scan_window(rows, baseline, [marker])
                finally:
                    if not reader.rollback():
                        raise SyntheticFailure("SYNTHETIC_ROLLBACK_FAILED")
                events = [{"source_event_id": row["source_event_id"],
                           "chat_ref": reference(reference_seed, "chat", row["chat_id"]),
                           "peer_ref": reference(reference_seed, "contact", row["contact_id"]),
                           "marker": row["marker"], "direction_code": row["direction_code"]}
                          for row in window["observations"]]
                applied.append(journal.observe_batch(events, window["cursor"]))
                if poll == 0:
                    _insert_duplicates(context, writer, marker)
            pending = journal.list_pending()
            if [value["inserted"] for value in applied] != [0, 2, 0] or applied[2]["existing"] != 2:
                raise SyntheticFailure("SYNTHETIC_POLL_RESULTS_FAILED")

        with Journal(state, epoch, account) as reopened:
            if reopened.snapshot() != {"baseline": 10, "cursor": 12, "pending": 2, "acked": 0, "total": 2}:
                raise SyntheticFailure("SYNTHETIC_DURABILITY_FAILED")
            if (reopened.list_pending() != pending or len(pending) != 2
                    or pending[0]["event_id"] == pending[1]["event_id"]):
                raise SyntheticFailure("SYNTHETIC_EVENT_ID_FAILED")
        fixture.check_plugin_loaded(context)
    finally:
        synthetic_key_hex = None
        rows = None
        try:
            if reader is not None:
                reader.close()
            reader = None
            context.sql.QSqlDatabase.removeDatabase(READER_NAME)
        finally:
            try:
                if writer is not None:
                    writer.close()
                writer = None
                context.sql.QSqlDatabase.removeDatabase(WRITER_NAME)
            finally:
                # Resolve and check the exact owned direct child immediately
                # before recursive removal; never remove a caller-supplied path.
                shutil.rmtree(_guard_temp(temporary, temp_root))
    return {
        "scope": "SYNTHETIC_ONLY", "status": "PASS",
        "runtime_version_verified": True, "plugin_hash_verified": True,
        "loaded_plugin_path_verified": True, "codec_see_compile_option": True,
        "keyed_source_connections": 2, "session_reader_opens": 1,
        "synthetic_key_submissions": 2, "rekey_calls": 0,
        "synthetic_application_key_reference_dropped": True,
        "secure_erasure_verified": False, "key_absence_verified": False,
        "plaintext_header_absent": True, "fresh_keyless_schema_read_rejected": True,
        "journal_mode": "wal", "wal_sidecars_present_before_reader": True,
        "readonly_create_rejected": True, "readonly_sqlite_base_error": 8,
        "polls": 3, "newly_journaled_per_poll": [0, 2, 0],
        "distinct_duplicate_events": 2, "replay_deduplicated": True,
        "pending_durable_after_reopen": 2, "provider_cipher_mode_identified": False,
        "private_database_opened": False, "viber_process_accessed": False,
        "account_keys_used": False, "messages_sent": 0,
    }


def main():
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    try:
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument("--bindings", required=True)
        args = parser.parse_args()
        result = verify(args.bindings)
    except SyntheticFailure as failure:
        result = {"scope": "SYNTHETIC_ONLY", "status": "FAIL", "error_code": failure.code}
    except SystemExit:
        result = {"scope": "SYNTHETIC_ONLY", "status": "FAIL", "error_code": "SYNTHETIC_ARGUMENTS"}
    except BaseException:
        result = {"scope": "SYNTHETIC_ONLY", "status": "FAIL", "error_code": "SYNTHETIC_SEE_SESSION_FAILED"}
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
