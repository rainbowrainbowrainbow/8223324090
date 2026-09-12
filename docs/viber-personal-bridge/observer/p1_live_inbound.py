"""Live inbound capture adapter for one enrolled Viber Desktop chat.

The adapter is intentionally narrow: it reads a caller-provided Viber message
source in read-only mode, enrolls exactly one chat with controlled PHONE/DESKTOP
markers, writes captured source events to a local SQLite journal first, and only
then imports them into the P1 bridge ledger for authenticated CRM delivery.

No real contact names, phone numbers or message text should be logged by callers.
Raw ChatID/ContactID are kept only in the local journal so the reader can resume;
CRM-facing identities are opaque HMAC references.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import hmac
from pathlib import Path
import sqlite3
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import quote

from p1_bridge_core import BridgeCore, BridgeCoreError
from p1_paired_queries import ANCHOR_SQL, PairedQueryError, resolve_anchor, scan_inbound


APPLICATION_ID = 0x45564C49  # "EVLI"
SCHEMA_VERSION = 1
MAX_EVENT_ID = (1 << 63) - 1
MAX_CAPTURE_BATCH = 50
REQUIRED_SCHEMA = {
    "Events": {"EventID", "ChatID", "ContactID", "Direction"},
    "Messages": {"EventID", "Body"},
}
MAX_EVENT_SQL = "SELECT MAX(EventID) FROM Events"
SCHEMA_SQL = "PRAGMA table_info({table})"
ANCHOR_AFTER_SQL = """
SELECT e.EventID, e.ChatID, e.ContactID, e.Direction
FROM Events e
JOIN Messages m ON m.EventID = e.EventID
WHERE m.Body COLLATE BINARY = :marker AND e.EventID > :after_event_id
ORDER BY e.EventID
LIMIT 2
"""


class LiveInboundError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _positive_id(value: Any, code: str) -> int:
    if type(value) is not int or not 1 <= value <= MAX_EVENT_ID:
        raise LiveInboundError(code)
    return value


def _hex_hmac(secret: bytes, label: str, value: Any) -> str:
    if not isinstance(secret, bytes) or len(secret) < 16:
        raise LiveInboundError("REFERENCE_KEY_INVALID")
    payload = f"{label}:{value}".encode("utf-8")
    return hmac.new(secret, payload, sha256).hexdigest()


def source_event_ref(secret: bytes, source_event_id: int) -> str:
    return _hex_hmac(secret, "viber-event", _positive_id(source_event_id, "SOURCE_EVENT_ID_INVALID"))


def source_chat_ref(secret: bytes, source_chat_id: int) -> str:
    return _hex_hmac(secret, "viber-chat", _positive_id(source_chat_id, "SOURCE_CHAT_ID_INVALID"))


def peer_ref(secret: bytes, peer_contact_id: int) -> str:
    return _hex_hmac(secret, "viber-peer", _positive_id(peer_contact_id, "PEER_CONTACT_ID_INVALID"))


def account_ref(secret: bytes, account_id: str) -> str:
    if not isinstance(account_id, str) or not account_id:
        raise LiveInboundError("ACCOUNT_ID_INVALID")
    return _hex_hmac(secret, "viber-account", account_id)


def source_generation_ref(secret: bytes, source_id: str) -> str:
    if not isinstance(source_id, str) or not source_id:
        raise LiveInboundError("SOURCE_ID_INVALID")
    return _hex_hmac(secret, "viber-source-generation", source_id)


def repository_root_for(path: Path) -> Path | None:
    for candidate in [path, *path.parents]:
        if (candidate / ".git").exists() and (candidate / "package.json").exists():
            return candidate
    return None


def _single_int(rows: list[tuple]) -> int:
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], tuple) or len(rows[0]) != 1:
        raise LiveInboundError("SOURCE_VALUE_UNSUPPORTED")
    value = rows[0][0]
    if value is None:
        return 0
    return _positive_id(value, "SOURCE_VALUE_UNSUPPORTED")


def max_event_id(reader: Callable[[str, dict, int, int], list[tuple]]) -> int:
    return _single_int(reader(MAX_EVENT_SQL, {}, 1, 1))



def resolve_anchor_after_baseline(reader: Callable[[str, dict, int, int], list[tuple]],
                                  phone_marker: str, desktop_marker: str,
                                  after_event_id: int) -> dict[str, int]:
    baseline = after_event_id if after_event_id == 0 else _positive_id(after_event_id, "BASELINE_INVALID")

    def filtered_reader(sql: str, params: dict, columns: int, limit: int) -> list[tuple]:
        if sql == ANCHOR_SQL:
            return reader(ANCHOR_AFTER_SQL, {**params, "after_event_id": baseline}, columns, limit)
        return reader(sql, params, columns, limit)

    return resolve_anchor(filtered_reader, phone_marker, desktop_marker)


def validate_schema(reader: Callable[[str, dict, int, int], list[tuple]]) -> str:
    parts = []
    for table, required_columns in sorted(REQUIRED_SCHEMA.items()):
        rows = reader(SCHEMA_SQL.format(table=table), {}, 6, 64)
        if not isinstance(rows, list) or any(not isinstance(row, tuple) or len(row) != 6 for row in rows):
            raise LiveInboundError("SOURCE_SCHEMA_UNSUPPORTED")
        columns = {row[1] for row in rows if isinstance(row[1], str)}
        if not required_columns.issubset(columns):
            raise LiveInboundError("SOURCE_SCHEMA_UNSUPPORTED")
        parts.append(f"{table}:" + ",".join(sorted(columns & required_columns)))
    return sha256("|".join(parts).encode("utf-8")).hexdigest()


class SqliteReadOnlySource:
    """Tiny read-only SQLite source for synthetic fixtures and copied DB files."""

    def __init__(self, path: str | Path):
        source_path = Path(path)
        if not source_path.is_absolute():
            raise LiveInboundError("SOURCE_DB_PATH_INVALID")
        self.path = source_path.resolve()
        if not self.path.exists() or not self.path.is_file():
            raise LiveInboundError("SOURCE_DB_NOT_FOUND")
        self._connection: sqlite3.Connection | None = None

    def open(self) -> None:
        try:
            uri = f"file:{quote(self.path.as_posix(), safe='/:')}?mode=ro"
            self._connection = sqlite3.connect(uri, uri=True, timeout=1, isolation_level=None)
        except sqlite3.Error as error:
            self.close()
            raise LiveInboundError("SOURCE_DB_OPEN_FAILED") from error

    def read_rows(self, sql: str, params: Mapping[str, Any] | None, columns: int, limit: int) -> list[tuple]:
        if self._connection is None:
            raise LiveInboundError("SOURCE_DB_CLOSED")
        if not isinstance(sql, str) or not isinstance(params or {}, Mapping):
            raise LiveInboundError("SOURCE_QUERY_INVALID")
        if type(columns) is not int or columns < 1 or type(limit) is not int or limit < 1 or limit > 128:
            raise LiveInboundError("SOURCE_QUERY_INVALID")
        try:
            rows = self._connection.execute(sql, dict(params or {})).fetchmany(limit + 1)
        except sqlite3.Error as error:
            raise LiveInboundError("SOURCE_QUERY_FAILED") from error
        result = [tuple(row) for row in rows]
        if len(result) > limit or any(len(row) != columns for row in result):
            raise LiveInboundError("SOURCE_VALUE_UNSUPPORTED")
        return result

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None


class LiveInboundJournal:
    def __init__(self, path: str | Path):
        journal_path = Path(path)
        if not journal_path.is_absolute():
            raise LiveInboundError("JOURNAL_PATH_INVALID")
        repository_root = repository_root_for(Path(__file__).resolve())
        try:
            if repository_root is not None and journal_path.resolve().is_relative_to(repository_root):
                raise LiveInboundError("JOURNAL_INSIDE_REPOSITORY")
        except OSError as error:
            raise LiveInboundError("JOURNAL_PATH_INVALID") from error
        self.path = journal_path.resolve()
        self.meta_path = self.path.with_name(self.path.name + ".meta")
        self._connection: sqlite3.Connection | None = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if not self.path.exists() and self.meta_path.exists():
                raise LiveInboundError("JOURNAL_LOST")
            self._connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA synchronous=FULL")
            with self._transaction() as db:
                app_id = db.execute("PRAGMA application_id").fetchone()[0]
                version = db.execute("PRAGMA user_version").fetchone()[0]
                tables = {row[0] for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
                expected = {"journal_state", "captured_events"}
                if not tables and app_id == 0 and version == 0:
                    self._create_schema(db)
                    self.meta_path.write_text("eventgenix-viber-personal-journal-v1\n", encoding="utf-8")
                elif app_id != APPLICATION_ID or version != SCHEMA_VERSION or tables != expected:
                    raise LiveInboundError("JOURNAL_SCHEMA_MISMATCH")
                elif not self.meta_path.exists():
                    self.meta_path.write_text("eventgenix-viber-personal-journal-v1\n", encoding="utf-8")
        except LiveInboundError:
            self.close()
            raise
        except (OSError, sqlite3.Error):
            self.close()
            raise LiveInboundError("JOURNAL_OPEN_FAILED") from None

    @staticmethod
    def _create_schema(db: sqlite3.Connection) -> None:
        db.execute("""
            CREATE TABLE journal_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                baseline_event_id INTEGER,
                cursor_event_id INTEGER,
                chat_id INTEGER,
                peer_contact_id INTEGER,
                inbound_code INTEGER,
                outbound_code INTEGER,
                anchor_event_id INTEGER,
                source_chat_ref TEXT,
                peer_ref TEXT,
                source_fingerprint TEXT,
                schema_fingerprint TEXT,
                status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'enrolled', 'blocked')),
                block_reason TEXT,
                last_scan_at TEXT
            )
        """)
        db.execute("INSERT INTO journal_state(id) VALUES(1)")
        db.execute("""
            CREATE TABLE captured_events (
                source_event_id INTEGER PRIMARY KEY,
                source_event_ref TEXT NOT NULL UNIQUE,
                source_chat_ref TEXT NOT NULL,
                peer_ref TEXT NOT NULL,
                direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound', 'unknown')),
                origin TEXT NOT NULL CHECK(origin IN ('crm_command', 'external_viber', 'unknown')),
                text TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'imported')),
                p1_event_id TEXT
            )
        """)
        db.execute("CREATE INDEX captured_events_status ON captured_events(status, source_event_id)")
        db.execute(f"PRAGMA application_id={APPLICATION_ID}")
        db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    @contextmanager
    def _transaction(self):
        if self._connection is None:
            raise LiveInboundError("JOURNAL_CLOSED")
        db = self._connection
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.execute("COMMIT")
        except BaseException as error:
            if db.in_transaction:
                db.execute("ROLLBACK")
            if isinstance(error, sqlite3.Error):
                raise LiveInboundError("JOURNAL_STORAGE_FAILED") from None
            raise

    def state(self) -> dict[str, Any]:
        with self._transaction() as db:
            return dict(db.execute("SELECT * FROM journal_state WHERE id=1").fetchone())

    def mark_blocked(self, reason: str, *, now: str | None = None) -> None:
        if not isinstance(reason, str) or not reason:
            reason = "CAPTURE_BLOCKED"
        with self._transaction() as db:
            db.execute(
                "UPDATE journal_state SET status='blocked', block_reason=?, last_scan_at=? WHERE id=1",
                (reason, now or utc_now()),
            )

    def ensure_baseline(self, current_max_event_id: int, *, now: str | None = None) -> int:
        current = _positive_id(current_max_event_id, "SOURCE_VALUE_UNSUPPORTED") if current_max_event_id else 0
        with self._transaction() as db:
            row = db.execute("SELECT baseline_event_id FROM journal_state WHERE id=1").fetchone()
            if row["baseline_event_id"] is None:
                db.execute(
                    "UPDATE journal_state SET baseline_event_id=?, cursor_event_id=?, status='waiting', "
                    "block_reason=NULL, last_scan_at=? WHERE id=1",
                    (current, current, now or utc_now()),
                )
                return current
            return row["baseline_event_id"]

    def enroll(self, anchor: Mapping[str, int], *, source_chat_ref_value: str, peer_ref_value: str,
               source_fingerprint: str, schema_fingerprint: str, now: str | None = None) -> None:
        required = {"chat_id", "peer_contact_id", "inbound_code", "outbound_code", "anchor_event_id"}
        if not isinstance(anchor, Mapping) or set(anchor) != required:
            raise LiveInboundError("ANCHOR_INVALID")
        with self._transaction() as db:
            state = db.execute("SELECT * FROM journal_state WHERE id=1").fetchone()
            if state["status"] == "enrolled":
                expected = (state["chat_id"], state["peer_contact_id"], state["inbound_code"],
                            state["outbound_code"], state["anchor_event_id"], state["source_chat_ref"],
                            state["peer_ref"], state["source_fingerprint"], state["schema_fingerprint"])
                actual = (anchor["chat_id"], anchor["peer_contact_id"], anchor["inbound_code"],
                          anchor["outbound_code"], anchor["anchor_event_id"], source_chat_ref_value,
                          peer_ref_value, source_fingerprint, schema_fingerprint)
                if expected != actual:
                    raise LiveInboundError("ENROLLMENT_CHANGED")
                return
            db.execute(
                "UPDATE journal_state SET status='enrolled', block_reason=NULL, chat_id=?, peer_contact_id=?, "
                "inbound_code=?, outbound_code=?, anchor_event_id=?, cursor_event_id=?, source_chat_ref=?, "
                "peer_ref=?, source_fingerprint=?, schema_fingerprint=?, last_scan_at=? WHERE id=1",
                (anchor["chat_id"], anchor["peer_contact_id"], anchor["inbound_code"],
                 anchor["outbound_code"], anchor["anchor_event_id"], anchor["anchor_event_id"],
                 source_chat_ref_value, peer_ref_value, source_fingerprint, schema_fingerprint,
                 now or utc_now()),
            )

    def verify_source(self, *, source_fingerprint: str, schema_fingerprint: str) -> None:
        with self._transaction() as db:
            state = db.execute("SELECT * FROM journal_state WHERE id=1").fetchone()
            if state["status"] != "enrolled":
                return
            if state["source_fingerprint"] != source_fingerprint:
                raise LiveInboundError("SOURCE_DB_CHANGED")
            if state["schema_fingerprint"] != schema_fingerprint:
                raise LiveInboundError("SOURCE_SCHEMA_CHANGED")

    def capture_events(self, rows: Iterable[Mapping[str, Any]], *, reference_key: bytes,
                       source_chat_ref_value: str, peer_ref_value: str, now: str | None = None) -> int:
        observed_at = now or utc_now()
        changed = 0
        max_seen = None
        with self._transaction() as db:
            state = db.execute("SELECT * FROM journal_state WHERE id=1").fetchone()
            if state["status"] != "enrolled":
                raise LiveInboundError("ENROLLMENT_REQUIRED")
            for row in rows:
                event_id = _positive_id(row.get("source_event_id"), "SOURCE_EVENT_ID_INVALID")
                text = row.get("text")
                if not isinstance(text, str) or not text:
                    raise LiveInboundError("MESSAGE_UNSUPPORTED")
                if event_id <= int(state["cursor_event_id"]):
                    raise LiveInboundError("CURSOR_REGRESSED")
                max_seen = event_id if max_seen is None else max(max_seen, event_id)
                cursor = db.execute(
                    "INSERT OR IGNORE INTO captured_events(source_event_id, source_event_ref, "
                    "source_chat_ref, peer_ref, direction, origin, text, observed_at) "
                    "VALUES(?, ?, ?, ?, 'inbound', 'external_viber', ?, ?)",
                    (event_id, source_event_ref(reference_key, event_id), source_chat_ref_value,
                     peer_ref_value, text, observed_at),
                )
                changed += cursor.rowcount
            if max_seen is not None:
                db.execute("UPDATE journal_state SET cursor_event_id=?, last_scan_at=? WHERE id=1",
                           (max_seen, observed_at))
            else:
                db.execute("UPDATE journal_state SET last_scan_at=? WHERE id=1", (observed_at,))
        return changed

    def pending_for_import(self, limit: int = MAX_CAPTURE_BATCH) -> list[dict[str, Any]]:
        if type(limit) is not int or not 1 <= limit <= MAX_CAPTURE_BATCH:
            raise LiveInboundError("IMPORT_LIMIT_INVALID")
        with self._transaction() as db:
            return [dict(row) for row in db.execute(
                "SELECT * FROM captured_events WHERE status='pending' ORDER BY source_event_id LIMIT ?",
                (limit,),
            )]

    def mark_imported(self, source_event_id: int, p1_event_id: str) -> None:
        _positive_id(source_event_id, "SOURCE_EVENT_ID_INVALID")
        if not isinstance(p1_event_id, str) or not p1_event_id:
            raise LiveInboundError("P1_EVENT_ID_INVALID")
        with self._transaction() as db:
            db.execute(
                "UPDATE captured_events SET status='imported', p1_event_id=? WHERE source_event_id=?",
                (p1_event_id, source_event_id),
            )

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None


def import_pending(core: BridgeCore, journal: LiveInboundJournal) -> int:
    imported = 0
    for row in journal.pending_for_import():
        event = core.ingest_observation({
            "source_event_ref": row["source_event_ref"],
            "source_chat_ref": row["source_chat_ref"],
            "peer_ref": row["peer_ref"],
            "direction": row["direction"],
            "origin": row["origin"],
            "text": row["text"],
            "observed_at": row["observed_at"],
        })
        journal.mark_imported(int(row["source_event_id"]), event["event_id"])
        imported += 1
    return imported


class LiveInboundAdapter:
    def __init__(self, *, journal: LiveInboundJournal,
                 reader: Callable[[str, dict, int, int], list[tuple]], reference_key: bytes,
                 phone_marker: str, desktop_marker: str, account_identity: str,
                 source_identity: str, source_handle: Any | None = None):
        if not callable(reader):
            raise LiveInboundError("SOURCE_READER_INVALID")
        self.journal = journal
        self.reader = reader
        self.reference_key = reference_key
        self.phone_marker = phone_marker
        self.desktop_marker = desktop_marker
        self.account_identity = account_identity
        self.source_identity = source_identity
        self.source_handle = source_handle
        self._last_result: dict[str, Any] = {"enabled": True, "receive_text": False, "block_reason": "NOT_SCANNED"}

    def capabilities(self) -> dict[str, Any]:
        state = self.journal.state()
        return {
            "receive_text": bool(self._last_result.get("receive_text")),
            "last_scan_at": state.get("last_scan_at"),
            "service_running": True,
            "desktop_authorized": state.get("status") == "enrolled" and not state.get("block_reason"),
            "block_reason": state.get("block_reason") or self._last_result.get("block_reason"),
        }

    def _block(self, core: BridgeCore, code: str) -> dict[str, Any]:
        try:
            core.set_receive_health(False)
        except BridgeCoreError:
            pass
        self.journal.mark_blocked(code)
        self._last_result = {"enabled": True, "receive_text": False, "block_reason": code}
        return self._last_result

    def close(self) -> None:
        self.journal.close()
        if self.source_handle is not None and hasattr(self.source_handle, "close"):
            self.source_handle.close()

    def scan_once(self, core: BridgeCore) -> dict[str, Any]:
        try:
            schema = validate_schema(self.reader)
            current_max = max_event_id(self.reader)
            source_fingerprint = sha256(str(self.source_identity).encode("utf-8")).hexdigest()
            state = self.journal.state()
            if state["status"] == "blocked":
                return self._block(core, state["block_reason"] or "CAPTURE_BLOCKED")
            if state["status"] != "enrolled":
                baseline = self.journal.ensure_baseline(current_max)
                try:
                    anchor = resolve_anchor_after_baseline(self.reader, self.phone_marker,
                                                           self.desktop_marker, baseline)
                except PairedQueryError as error:
                    if error.code == "ANCHOR_AMBIGUOUS":
                        core.set_receive_health(False)
                        self._last_result = {"enabled": True, "receive_text": False,
                                             "block_reason": "WAITING_FOR_ENROLLMENT_MARKERS"}
                        return self._last_result
                    raise
                chat_ref = source_chat_ref(self.reference_key, anchor["chat_id"])
                peer = peer_ref(self.reference_key, anchor["peer_contact_id"])
                self.journal.enroll(anchor, source_chat_ref_value=chat_ref, peer_ref_value=peer,
                                    source_fingerprint=source_fingerprint, schema_fingerprint=schema)
                core.verify_source(account_ref=account_ref(self.reference_key, self.account_identity),
                                   source_generation_ref=source_generation_ref(self.reference_key,
                                                                               self.source_identity),
                                   receive_healthy=True)
                binding = core.discover_source_chat(source_chat_ref=chat_ref, peer_ref=peer)
                core.verify_peer(chat_id=binding["chat_id"], expected_source_chat_ref=chat_ref,
                                 expected_peer_ref=peer)
                state = self.journal.state()
            else:
                self.journal.verify_source(source_fingerprint=source_fingerprint, schema_fingerprint=schema)
                core.verify_source(account_ref=account_ref(self.reference_key, self.account_identity),
                                   source_generation_ref=source_generation_ref(self.reference_key,
                                                                               self.source_identity),
                                   receive_healthy=True)
            binding = core.discover_source_chat(source_chat_ref=state["source_chat_ref"],
                                                peer_ref=state["peer_ref"])
            core.verify_peer(chat_id=binding["chat_id"], expected_source_chat_ref=state["source_chat_ref"],
                             expected_peer_ref=state["peer_ref"])
            anchor = {
                "chat_id": int(state["chat_id"]),
                "peer_contact_id": int(state["peer_contact_id"]),
                "inbound_code": int(state["inbound_code"]),
                "outbound_code": int(state["outbound_code"]),
                "anchor_event_id": int(state["anchor_event_id"]),
            }
            rows = scan_inbound(self.reader, anchor, int(state["cursor_event_id"]), limit=MAX_CAPTURE_BATCH)
            captured = self.journal.capture_events(rows, reference_key=self.reference_key,
                                                   source_chat_ref_value=state["source_chat_ref"],
                                                   peer_ref_value=state["peer_ref"])
            imported = import_pending(core, self.journal)
            core.set_receive_health(True)
            self._last_result = {"enabled": True, "receive_text": True, "captured": captured,
                                 "imported": imported, "block_reason": None}
            return self._last_result
        except (LiveInboundError, PairedQueryError, BridgeCoreError) as error:
            return self._block(core, getattr(error, "code", "CAPTURE_FAILED"))
