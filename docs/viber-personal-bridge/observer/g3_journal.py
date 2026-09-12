"""Durable, synthetic-marker-only receive journal for the isolated G3 probe.

No Viber access, networking, sending, or output is performed here. Callers must
keep the state file outside the repository and supply HMAC references, never
contact names, phone numbers, message bodies, account sessions, or keys.
The cursor records scan progress; events above the initial baseline may still
be added below that cursor when their synthetic marker becomes available later.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import re
import sqlite3
from typing import Iterable, Mapping, Any
from uuid import uuid4


SCHEMA_VERSION = 1
APPLICATION_ID = 0x45475833
MAX_SOURCE_ID = (1 << 63) - 1
MAX_BATCH_SIZE = 1000
_HMAC_REF = re.compile(r"hmac:[0-9a-f]{64}\Z")
_MARKER = re.compile(r"EGXG3-[0-9A-F]{8}-(?:DUP|NEW|PHONE|DESKTOP|RENAME)\Z")
_EVENT_ID = re.compile(r"evt_[0-9a-f]{32}\Z")
_REQUIRED_FIELDS = frozenset({"source_event_id", "chat_ref", "peer_ref", "marker"})
_OPTIONAL_FIELDS = frozenset({"direction_code"})


class JournalError(Exception):
    """The fixed code is safe to report; supplied values are never included."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class EpochMismatch(JournalError):
    def __init__(self):
        super().__init__("SOURCE_EPOCH_OR_ACCOUNT_MISMATCH")


class EventConflict(JournalError):
    def __init__(self):
        super().__init__("SOURCE_EVENT_ID_CONFLICT")


def _source_id(value: Any, *, allow_zero: bool = False) -> int:
    if type(value) is not int or not (0 if allow_zero else 1) <= value <= MAX_SOURCE_ID:
        raise JournalError("SOURCE_ID_INVALID")
    return value


def _ref(value: Any) -> str:
    if not isinstance(value, str) or _HMAC_REF.fullmatch(value) is None:
        raise JournalError("HMAC_REFERENCE_INVALID")
    return value


def _event(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise JournalError("EVENT_SHAPE_INVALID")
    fields = set(value)
    if not _REQUIRED_FIELDS <= fields or fields - _REQUIRED_FIELDS - _OPTIONAL_FIELDS:
        raise JournalError("EVENT_FIELDS_INVALID")
    marker = value["marker"]
    if not isinstance(marker, str) or _MARKER.fullmatch(marker) is None:
        raise JournalError("SYNTHETIC_MARKER_INVALID")
    direction = value.get("direction_code")
    if direction is not None and (type(direction) is not int or direction not in (0, 1, 2, 3)):
        raise JournalError("DIRECTION_CODE_INVALID")
    return {
        "source_event_id": _source_id(value["source_event_id"]),
        "chat_ref": _ref(value["chat_ref"]),
        "peer_ref": _ref(value["peer_ref"]),
        "marker": marker,
        "direction_code": direction,
    }


class Journal:
    """One source epoch/account per file. Acknowledgements are local test ACKs.

    Use a fresh file for another source epoch. An existing file is never rebound
    or silently reset. HMAC references are identifiers supplied by the caller;
    validating their syntax cannot prove how the caller derived them.
    """

    def __init__(self, path: str | Path, source_epoch: str, account_ref: str):
        self.source_epoch = _ref(source_epoch)
        self.account_ref = _ref(account_ref)
        self._connection: sqlite3.Connection | None = None
        try:
            state_path = Path(path).resolve()
            repository_root = Path(__file__).resolve().parents[3]
            if state_path.is_relative_to(repository_root):
                raise JournalError("STATE_INSIDE_REPOSITORY")
            state_path.parent.mkdir(parents=True, exist_ok=True)
            self._connection = sqlite3.connect(state_path, timeout=5, isolation_level=None)
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA synchronous=FULL")
            with self._transaction() as db:
                app_id = db.execute("PRAGMA application_id").fetchone()[0]
                version = db.execute("PRAGMA user_version").fetchone()[0]
                tables = {
                    row[0] for row in db.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                }
                if not tables and app_id == 0 and version == 0:
                    self._create_schema(db)
                    db.execute(
                        "INSERT INTO source_state(id, source_epoch, account_ref) VALUES(1, ?, ?)",
                        (self.source_epoch, self.account_ref),
                    )
                elif app_id != APPLICATION_ID or version != SCHEMA_VERSION or tables != {"source_state", "events"}:
                    raise JournalError("JOURNAL_SCHEMA_MISMATCH")
                self._state(db)
        except JournalError:
            self.close()
            raise
        except (OSError, ValueError, sqlite3.Error):
            self.close()
            raise JournalError("JOURNAL_OPEN_FAILED") from None

    @staticmethod
    def _create_schema(db: sqlite3.Connection) -> None:
        # Execute statements individually: executescript can implicitly commit.
        db.execute("""
            CREATE TABLE source_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                source_epoch TEXT NOT NULL,
                account_ref TEXT NOT NULL,
                baseline INTEGER CHECK(baseline >= 0),
                cursor INTEGER CHECK(cursor >= baseline),
                CHECK((baseline IS NULL AND cursor IS NULL) OR
                      (baseline IS NOT NULL AND cursor IS NOT NULL))
            )
        """)
        db.execute("""
            CREATE TABLE events (
                source_event_id INTEGER PRIMARY KEY CHECK(source_event_id > 0),
                event_id TEXT NOT NULL UNIQUE,
                chat_ref TEXT NOT NULL,
                peer_ref TEXT NOT NULL,
                marker TEXT NOT NULL,
                direction_code INTEGER CHECK(direction_code IN (0, 1, 2, 3)),
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'acked'))
            )
        """)
        db.execute("CREATE INDEX events_pending ON events(status, source_event_id)")
        db.execute(f"PRAGMA application_id={APPLICATION_ID}")
        db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    @contextmanager
    def _transaction(self):
        if self._connection is None:
            raise JournalError("JOURNAL_CLOSED")
        db = self._connection
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.execute("COMMIT")
        except BaseException as error:
            if db.in_transaction:
                db.execute("ROLLBACK")
            if isinstance(error, sqlite3.Error):
                raise JournalError("JOURNAL_STORAGE_FAILED") from None
            raise

    def _state(self, db: sqlite3.Connection) -> sqlite3.Row:
        row = db.execute("SELECT * FROM source_state WHERE id=1").fetchone()
        if row is None:
            raise JournalError("JOURNAL_STATE_MISSING")
        if row["source_epoch"] != self.source_epoch or row["account_ref"] != self.account_ref:
            raise EpochMismatch()
        return row

    def initialize_baseline(self, source_event_id: int) -> int:
        """Persist the first baseline exactly once; return it on every call."""
        baseline = _source_id(source_event_id, allow_zero=True)
        with self._transaction() as db:
            row = self._state(db)
            if row["baseline"] is None:
                db.execute("UPDATE source_state SET baseline=?, cursor=? WHERE id=1", (baseline, baseline))
                return baseline
            return row["baseline"]

    def observe_batch(self, events: Iterable[Mapping[str, Any]], observed_cursor: int) -> dict[str, int]:
        """Atomically journal events and scan progress, including late rows.

        Same source ID with a different immutable field rejects the entire
        batch. Identical text with different source IDs remains separate.
        The caller rereads above baseline, not merely above the cursor.
        """
        progress = _source_id(observed_cursor, allow_zero=True)
        batch = []
        for candidate in events:
            if len(batch) >= MAX_BATCH_SIZE:
                raise JournalError("BATCH_LIMIT_EXCEEDED")
            batch.append(_event(candidate))
        inserted = existing = 0
        with self._transaction() as db:
            state = self._state(db)
            if state["baseline"] is None:
                raise JournalError("BASELINE_REQUIRED")
            if progress < state["baseline"]:
                raise JournalError("SOURCE_BELOW_BASELINE")
            for event in batch:
                if event["source_event_id"] <= state["baseline"]:
                    raise JournalError("EVENT_NOT_AFTER_BASELINE")
                if event["source_event_id"] > progress:
                    raise JournalError("EVENT_AFTER_OBSERVED_CURSOR")
                old = db.execute("SELECT * FROM events WHERE source_event_id=?", (event["source_event_id"],)).fetchone()
                if old is not None:
                    if any(old[field] != event[field] for field in event):
                        raise EventConflict()
                    existing += 1
                    continue
                db.execute(
                    "INSERT INTO events(source_event_id, event_id, chat_ref, peer_ref, marker, direction_code) "
                    "VALUES(?, ?, ?, ?, ?, ?)",
                    (event["source_event_id"], "evt_" + uuid4().hex, event["chat_ref"],
                     event["peer_ref"], event["marker"], event["direction_code"]),
                )
                inserted += 1
            cursor = max(state["cursor"], progress)
            db.execute("UPDATE source_state SET cursor=? WHERE id=1", (cursor,))
            pending = db.execute("SELECT COUNT(*) FROM events WHERE status='pending'").fetchone()[0]
            return {"inserted": inserted, "existing": existing, "cursor": cursor, "pending": pending}

    def list_pending(self, limit: int = 100) -> list[dict[str, Any]]:
        if type(limit) is not int or not 1 <= limit <= MAX_BATCH_SIZE:
            raise JournalError("PENDING_LIMIT_INVALID")
        with self._transaction() as db:
            self._state(db)
            return [dict(row) for row in db.execute(
                "SELECT * FROM events WHERE status='pending' ORDER BY source_event_id LIMIT ?", (limit,)
            )]

    def ack(self, event_ids: Iterable[str]) -> int:
        """Apply local test acknowledgements; retries never enqueue new events."""
        unique = set()
        for index, event_id in enumerate(event_ids):
            if index >= MAX_BATCH_SIZE:
                raise JournalError("BATCH_LIMIT_EXCEEDED")
            if not isinstance(event_id, str) or _EVENT_ID.fullmatch(event_id) is None:
                raise JournalError("EVENT_ID_INVALID")
            unique.add(event_id)
        changed = 0
        with self._transaction() as db:
            self._state(db)
            for event_id in unique:
                old = db.execute("SELECT status FROM events WHERE event_id=?", (event_id,)).fetchone()
                if old is None:
                    raise JournalError("ACK_EVENT_UNKNOWN")
                if old["status"] == "pending":
                    db.execute("UPDATE events SET status='acked' WHERE event_id=?", (event_id,))
                    changed += 1
        return changed

    def snapshot(self) -> dict[str, int | None]:
        """Internal diagnostics contain raw numeric IDs; redact before reporting."""
        with self._transaction() as db:
            state = self._state(db)
            counts = {row[0]: row[1] for row in db.execute("SELECT status, COUNT(*) FROM events GROUP BY status")}
            return {"baseline": state["baseline"], "cursor": state["cursor"],
                    "pending": counts.get("pending", 0), "acked": counts.get("acked", 0),
                    "total": sum(counts.values())}

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def __enter__(self) -> "Journal":
        return self

    def __exit__(self, *_args) -> None:
        self.close()
