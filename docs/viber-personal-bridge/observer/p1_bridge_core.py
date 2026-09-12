"""Fail-closed identity and command ledger for the Viber P1 prototype.

This module has no Viber UI or network side effects. It persists synthetic/local
prototype state only and deliberately refuses to authorize Send until the
account, source generation and exact one-to-one peer binding are verified.
"""

from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
from typing import Any, Iterable, Mapping
from uuid import uuid4


APPLICATION_ID = 0x45565031  # "EVP1"
SCHEMA_VERSION = 2
BUSINESS_CONTEXTS = frozenset({"event_genix", "dar"})
COMMAND_STATES = frozenset({
    "accepted", "preparing", "dispatch_started", "submitted_unconfirmed",
    "failed", "unknown", "rejected",
})
TERMINAL_STATES = frozenset({"submitted_unconfirmed", "failed", "unknown", "rejected"})
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_OPAQUE_REF = re.compile(r"^(?:hmac:)?[0-9a-f]{64}$")
_CLIENT_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{16,80}$")


class BridgeCoreError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class CommandConflict(BridgeCoreError):
    def __init__(self):
        super().__init__("COMMAND_ID_CONFLICT")


class InboundEventConflict(BridgeCoreError):
    def __init__(self):
        super().__init__("INBOUND_EVENT_CONFLICT")


def _uuid(value: Any, code: str) -> str:
    if not isinstance(value, str) or _UUID.fullmatch(value) is None:
        raise BridgeCoreError(code)
    return value


def _ref(value: Any, code: str) -> str:
    if not isinstance(value, str) or _OPAQUE_REF.fullmatch(value) is None:
        raise BridgeCoreError(code)
    return value


def _client_request_id(value: Any) -> str:
    if not isinstance(value, str) or _CLIENT_REQUEST_ID.fullmatch(value) is None:
        raise BridgeCoreError("CLIENT_REQUEST_ID_INVALID")
    return value


def _business(value: Any) -> str:
    if value not in BUSINESS_CONTEXTS:
        raise BridgeCoreError("BUSINESS_CONTEXT_INVALID")
    return value


def _epoch(value: Any) -> int:
    if type(value) is not int or value < 1:
        raise BridgeCoreError("ACCOUNT_EPOCH_INVALID")
    return value


def _revision(value: Any) -> int:
    if type(value) is not int or value < 1:
        raise BridgeCoreError("BINDING_REVISION_INVALID")
    return value


def _text(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 4000 or len(value.encode("utf-8")) > 16384:
        raise BridgeCoreError("TEXT_INVALID")
    return value


def _payload_hash(command: Mapping[str, Any]) -> str:
    canonical = {
        "bridge_id": command["bridge_id"],
        "account_id": command["account_id"],
        "account_epoch": command["account_epoch"],
        "business_context": command["business_context"],
        "chat_id": command["chat_id"],
        "binding_revision": command["binding_revision"],
        "text": command["text"],
    }
    return sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":")).encode("utf-8")).hexdigest()


class BridgeCore:
    """Durable P1 state for one provisioned bridge/account/business tuple."""

    def __init__(self, path: str | Path, *, bridge_id: str, account_id: str,
                 account_epoch: int, business_context: str):
        self.bridge_id = _uuid(bridge_id, "BRIDGE_ID_INVALID")
        self.account_id = _uuid(account_id, "ACCOUNT_ID_INVALID")
        self.account_epoch = _epoch(account_epoch)
        self.business_context = _business(business_context)
        self._connection: sqlite3.Connection | None = None
        try:
            state_path = Path(path).resolve()
            repository_root = Path(__file__).resolve().parents[3]
            if state_path.is_relative_to(repository_root):
                raise BridgeCoreError("STATE_INSIDE_REPOSITORY")
            state_path.parent.mkdir(parents=True, exist_ok=True)
            self._connection = sqlite3.connect(state_path, timeout=5, isolation_level=None)
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA synchronous=FULL")
            with self._transaction() as db:
                app_id = db.execute("PRAGMA application_id").fetchone()[0]
                version = db.execute("PRAGMA user_version").fetchone()[0]
                tables = {row[0] for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
                expected = {"bridge_state", "chat_bindings", "commands", "inbound_events"}
                if not tables and app_id == 0 and version == 0:
                    self._create_schema(db)
                    db.execute(
                        "INSERT INTO bridge_state(id, bridge_id, account_id, account_epoch, business_context) "
                        "VALUES(1, ?, ?, ?, ?)",
                        (self.bridge_id, self.account_id, self.account_epoch, self.business_context),
                    )
                elif app_id != APPLICATION_ID or version != SCHEMA_VERSION or tables != expected:
                    raise BridgeCoreError("LEDGER_SCHEMA_MISMATCH")
                self._verify_scope(db)
        except BridgeCoreError:
            self.close()
            raise
        except (OSError, ValueError, sqlite3.Error):
            self.close()
            raise BridgeCoreError("LEDGER_OPEN_FAILED") from None

    @staticmethod
    def _create_schema(db: sqlite3.Connection) -> None:
        db.execute("""
            CREATE TABLE bridge_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                bridge_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                account_epoch INTEGER NOT NULL CHECK(account_epoch > 0),
                business_context TEXT NOT NULL CHECK(business_context IN ('event_genix', 'dar')),
                account_ref TEXT,
                source_generation_ref TEXT,
                account_verified INTEGER NOT NULL DEFAULT 0 CHECK(account_verified IN (0, 1)),
                receive_healthy INTEGER NOT NULL DEFAULT 0 CHECK(receive_healthy IN (0, 1))
            )
        """)
        db.execute("""
            CREATE TABLE chat_bindings (
                chat_id TEXT PRIMARY KEY,
                source_chat_ref TEXT NOT NULL UNIQUE,
                peer_ref TEXT NOT NULL,
                binding_revision INTEGER NOT NULL CHECK(binding_revision > 0),
                identity_level TEXT NOT NULL CHECK(identity_level IN ('unresolved', 'verified')),
                chat_kind TEXT NOT NULL CHECK(chat_kind IN ('one_to_one', 'unsupported'))
            )
        """)
        db.execute("""
            CREATE TABLE commands (
                command_id TEXT PRIMARY KEY,
                client_request_id TEXT NOT NULL UNIQUE,
                payload_hash TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                binding_revision INTEGER NOT NULL,
                text TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN (
                    'accepted', 'preparing', 'dispatch_started',
                    'submitted_unconfirmed', 'failed', 'unknown', 'rejected')),
                error_code TEXT,
                dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_count IN (0, 1))
            )
        """)
        db.execute("CREATE INDEX commands_status ON commands(status)")
        db.execute("""
            CREATE TABLE inbound_events (
                event_id TEXT PRIMARY KEY,
                sequence INTEGER NOT NULL UNIQUE CHECK(sequence > 0),
                source_event_ref TEXT NOT NULL UNIQUE,
                chat_id TEXT NOT NULL,
                source_chat_ref TEXT NOT NULL,
                peer_ref TEXT NOT NULL,
                binding_revision INTEGER NOT NULL CHECK(binding_revision > 0),
                identity_level TEXT NOT NULL CHECK(identity_level IN ('unresolved', 'verified')),
                direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound', 'unknown')),
                origin TEXT NOT NULL CHECK(origin IN ('crm_command', 'external_viber', 'unknown')),
                text TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'acked'))
            )
        """)
        db.execute("CREATE INDEX inbound_events_pending ON inbound_events(status, sequence)")
        db.execute(f"PRAGMA application_id={APPLICATION_ID}")
        db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    @contextmanager
    def _transaction(self):
        if self._connection is None:
            raise BridgeCoreError("LEDGER_CLOSED")
        db = self._connection
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.execute("COMMIT")
        except BaseException as error:
            if db.in_transaction:
                db.execute("ROLLBACK")
            if isinstance(error, sqlite3.Error):
                raise BridgeCoreError("LEDGER_STORAGE_FAILED") from None
            raise

    def _verify_scope(self, db: sqlite3.Connection) -> sqlite3.Row:
        row = db.execute("SELECT * FROM bridge_state WHERE id=1").fetchone()
        if row is None:
            raise BridgeCoreError("LEDGER_STATE_MISSING")
        actual = (row["bridge_id"], row["account_id"], row["account_epoch"], row["business_context"])
        expected = (self.bridge_id, self.account_id, self.account_epoch, self.business_context)
        if actual != expected:
            raise BridgeCoreError("BRIDGE_SCOPE_MISMATCH")
        return row

    def verify_source(self, *, account_ref: str, source_generation_ref: str,
                      receive_healthy: bool) -> None:
        account = _ref(account_ref, "ACCOUNT_REF_INVALID")
        generation = _ref(source_generation_ref, "SOURCE_GENERATION_INVALID")
        if type(receive_healthy) is not bool:
            raise BridgeCoreError("RECEIVE_HEALTH_INVALID")
        mismatch = None
        with self._transaction() as db:
            state = self._verify_scope(db)
            if state["account_ref"] is not None and state["account_ref"] != account:
                db.execute("UPDATE bridge_state SET account_verified=0, receive_healthy=0 WHERE id=1")
                mismatch = "ACCOUNT_SOURCE_CHANGED"
            elif state["source_generation_ref"] is not None and state["source_generation_ref"] != generation:
                db.execute("UPDATE bridge_state SET account_verified=0, receive_healthy=0 WHERE id=1")
                mismatch = "SOURCE_GENERATION_CHANGED"
            else:
                db.execute(
                    "UPDATE bridge_state SET account_ref=?, source_generation_ref=?, account_verified=1, "
                    "receive_healthy=? WHERE id=1",
                    (account, generation, int(receive_healthy)),
                )
        if mismatch is not None:
            raise BridgeCoreError(mismatch)

    def set_receive_health(self, healthy: bool) -> None:
        if type(healthy) is not bool:
            raise BridgeCoreError("RECEIVE_HEALTH_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            db.execute("UPDATE bridge_state SET receive_healthy=? WHERE id=1", (int(healthy),))

    def discover_chat(self, *, chat_id: str, source_chat_ref: str, peer_ref: str,
                      chat_kind: str = "one_to_one") -> dict[str, Any]:
        chat = _uuid(chat_id, "CHAT_ID_INVALID")
        source = _ref(source_chat_ref, "SOURCE_CHAT_REF_INVALID")
        peer = _ref(peer_ref, "PEER_REF_INVALID")
        if chat_kind not in {"one_to_one", "unsupported"}:
            raise BridgeCoreError("CHAT_KIND_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            existing = db.execute(
                "SELECT * FROM chat_bindings WHERE chat_id=? OR source_chat_ref=?", (chat, source)
            ).fetchall()
            if existing:
                if len(existing) != 1 or existing[0]["chat_id"] != chat or existing[0]["source_chat_ref"] != source:
                    raise BridgeCoreError("CHAT_IDENTITY_CONFLICT")
                if existing[0]["peer_ref"] != peer or existing[0]["chat_kind"] != chat_kind:
                    raise BridgeCoreError("CHAT_IDENTITY_CONFLICT")
                return dict(existing[0])
            db.execute(
                "INSERT INTO chat_bindings(chat_id, source_chat_ref, peer_ref, binding_revision, "
                "identity_level, chat_kind) VALUES(?, ?, ?, 1, 'unresolved', ?)",
                (chat, source, peer, chat_kind),
            )
            return dict(db.execute("SELECT * FROM chat_bindings WHERE chat_id=?", (chat,)).fetchone())

    def discover_source_chat(self, *, source_chat_ref: str, peer_ref: str,
                             chat_kind: str = "one_to_one") -> dict[str, Any]:
        """Create one durable local chat UUID for a newly observed source chat."""
        source = _ref(source_chat_ref, "SOURCE_CHAT_REF_INVALID")
        peer = _ref(peer_ref, "PEER_REF_INVALID")
        if chat_kind not in {"one_to_one", "unsupported"}:
            raise BridgeCoreError("CHAT_KIND_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            existing = db.execute(
                "SELECT * FROM chat_bindings WHERE source_chat_ref=?", (source,)
            ).fetchone()
            if existing is not None:
                if existing["peer_ref"] != peer or existing["chat_kind"] != chat_kind:
                    raise BridgeCoreError("CHAT_IDENTITY_CONFLICT")
                return dict(existing)
            chat = str(uuid4())
            db.execute(
                "INSERT INTO chat_bindings(chat_id, source_chat_ref, peer_ref, binding_revision, "
                "identity_level, chat_kind) VALUES(?, ?, ?, 1, 'unresolved', ?)",
                (chat, source, peer, chat_kind),
            )
            return dict(db.execute("SELECT * FROM chat_bindings WHERE chat_id=?", (chat,)).fetchone())

    def verify_peer(self, *, chat_id: str, expected_source_chat_ref: str,
                    expected_peer_ref: str) -> int:
        chat = _uuid(chat_id, "CHAT_ID_INVALID")
        source = _ref(expected_source_chat_ref, "SOURCE_CHAT_REF_INVALID")
        peer = _ref(expected_peer_ref, "PEER_REF_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            row = db.execute("SELECT * FROM chat_bindings WHERE chat_id=?", (chat,)).fetchone()
            if row is None or row["source_chat_ref"] != source or row["peer_ref"] != peer:
                raise BridgeCoreError("PEER_VERIFICATION_FAILED")
            if row["chat_kind"] != "one_to_one":
                raise BridgeCoreError("CHAT_KIND_UNSUPPORTED")
            if row["identity_level"] == "verified":
                return row["binding_revision"]
            revision = row["binding_revision"] + 1
            db.execute(
                "UPDATE chat_bindings SET identity_level='verified', binding_revision=? WHERE chat_id=?",
                (revision, chat),
            )
            return revision

    def rebind_peer(self, *, chat_id: str, expected_source_chat_ref: str,
                    new_peer_ref: str) -> int:
        """Invalidate the old peer before a deliberate, separate re-verification."""
        chat = _uuid(chat_id, "CHAT_ID_INVALID")
        source = _ref(expected_source_chat_ref, "SOURCE_CHAT_REF_INVALID")
        peer = _ref(new_peer_ref, "PEER_REF_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            row = db.execute("SELECT * FROM chat_bindings WHERE chat_id=?", (chat,)).fetchone()
            if row is None or row["source_chat_ref"] != source:
                raise BridgeCoreError("CHAT_IDENTITY_CONFLICT")
            if row["peer_ref"] == peer:
                return row["binding_revision"]
            revision = row["binding_revision"] + 1
            db.execute(
                "UPDATE chat_bindings SET peer_ref=?, identity_level='unresolved', "
                "binding_revision=? WHERE chat_id=?",
                (peer, revision, chat),
            )
            db.execute(
                "UPDATE commands SET status='rejected', error_code='BINDING_REVISION_STALE' "
                "WHERE chat_id=? AND status IN ('accepted', 'preparing') AND binding_revision<?",
                (chat, revision),
            )
            return revision

    def accept_command(self, command: Mapping[str, Any]) -> dict[str, Any]:
        required = {"command_id", "client_request_id", "bridge_id", "account_id", "account_epoch",
                    "business_context", "chat_id", "binding_revision", "text"}
        if not isinstance(command, Mapping) or set(command) != required:
            raise BridgeCoreError("COMMAND_SHAPE_INVALID")
        command_id = _uuid(command["command_id"], "COMMAND_ID_INVALID")
        client_request_id = _client_request_id(command["client_request_id"])
        bridge_id = _uuid(command["bridge_id"], "BRIDGE_ID_INVALID")
        account_id = _uuid(command["account_id"], "ACCOUNT_ID_INVALID")
        account_epoch = _epoch(command["account_epoch"])
        business_context = _business(command["business_context"])
        chat_id = _uuid(command["chat_id"], "CHAT_ID_INVALID")
        binding_revision = _revision(command["binding_revision"])
        text = _text(command["text"])
        payload_hash = _payload_hash(command)
        if (bridge_id, account_id, account_epoch, business_context) != (
                self.bridge_id, self.account_id, self.account_epoch, self.business_context):
            raise BridgeCoreError("COMMAND_SCOPE_MISMATCH")
        with self._transaction() as db:
            self._verify_scope(db)
            old = db.execute(
                "SELECT * FROM commands WHERE command_id=? OR client_request_id=?",
                (command_id, client_request_id),
            ).fetchall()
            if old:
                if len(old) != 1 or old[0]["command_id"] != command_id or old[0]["client_request_id"] != client_request_id or old[0]["payload_hash"] != payload_hash:
                    raise CommandConflict()
                return dict(old[0])
            chat = db.execute("SELECT * FROM chat_bindings WHERE chat_id=?", (chat_id,)).fetchone()
            status, error = "accepted", None
            if chat is None:
                status, error = "rejected", "CHAT_UNKNOWN"
            elif chat["chat_kind"] != "one_to_one":
                status, error = "rejected", "CHAT_KIND_UNSUPPORTED"
            elif chat["identity_level"] != "verified":
                status, error = "rejected", "PEER_UNVERIFIED"
            elif chat["binding_revision"] != binding_revision:
                status, error = "rejected", "BINDING_REVISION_STALE"
            db.execute(
                "INSERT INTO commands(command_id, client_request_id, payload_hash, chat_id, "
                "binding_revision, text, status, error_code) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (command_id, client_request_id, payload_hash, chat_id, binding_revision,
                 text, status, error),
            )
            return dict(db.execute("SELECT * FROM commands WHERE command_id=?", (command_id,)).fetchone())

    def ingest_observation(self, observation: Mapping[str, Any]) -> dict[str, Any]:
        """Persist one source occurrence for later CRM ACK.

        The caller must derive all source references with its local HMAC key.
        Mutable names and raw phone numbers are intentionally not accepted.
        """
        required = {"source_event_ref", "source_chat_ref", "peer_ref", "direction",
                    "origin", "text", "observed_at"}
        if not isinstance(observation, Mapping) or set(observation) != required:
            raise BridgeCoreError("OBSERVATION_SHAPE_INVALID")
        source_event_ref = _ref(observation["source_event_ref"], "SOURCE_EVENT_REF_INVALID")
        source_chat_ref = _ref(observation["source_chat_ref"], "SOURCE_CHAT_REF_INVALID")
        peer_ref = _ref(observation["peer_ref"], "PEER_REF_INVALID")
        direction = observation["direction"]
        origin = observation["origin"]
        text = _text(observation["text"])
        observed_at = observation["observed_at"]
        if direction not in {"inbound", "outbound", "unknown"}:
            raise BridgeCoreError("DIRECTION_INVALID")
        if origin not in {"crm_command", "external_viber", "unknown"}:
            raise BridgeCoreError("ORIGIN_INVALID")
        if (not isinstance(observed_at, str) or len(observed_at) > 40
                or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", observed_at) is None):
            raise BridgeCoreError("OBSERVED_AT_INVALID")
        with self._transaction() as db:
            state = self._verify_scope(db)
            if not state["account_verified"]:
                raise BridgeCoreError("ACCOUNT_UNVERIFIED")
            chat = db.execute(
                "SELECT * FROM chat_bindings WHERE source_chat_ref=?", (source_chat_ref,)
            ).fetchone()
            if chat is None:
                raise BridgeCoreError("CHAT_UNDISCOVERED")
            if chat["peer_ref"] != peer_ref:
                raise BridgeCoreError("OBSERVATION_PEER_MISMATCH")
            old = db.execute(
                "SELECT * FROM inbound_events WHERE source_event_ref=?", (source_event_ref,)
            ).fetchone()
            snapshot = {
                "chat_id": chat["chat_id"],
                "source_chat_ref": source_chat_ref,
                "peer_ref": peer_ref,
                "binding_revision": chat["binding_revision"],
                "identity_level": chat["identity_level"],
                "direction": direction,
                "origin": origin,
                "text": text,
                "observed_at": observed_at,
            }
            if old is not None:
                source_facts = ("chat_id", "source_chat_ref", "peer_ref", "direction", "origin", "text")
                if any(old[field] != snapshot[field] for field in source_facts):
                    raise InboundEventConflict()
                return dict(old)
            sequence = db.execute("SELECT COALESCE(MAX(sequence), 0) + 1 FROM inbound_events").fetchone()[0]
            event_id = str(uuid4())
            db.execute(
                "INSERT INTO inbound_events(event_id, sequence, source_event_ref, chat_id, "
                "source_chat_ref, peer_ref, binding_revision, identity_level, direction, origin, "
                "text, observed_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (event_id, sequence, source_event_ref, *snapshot.values()),
            )
            return dict(db.execute("SELECT * FROM inbound_events WHERE event_id=?", (event_id,)).fetchone())

    def list_pending_events(self, limit: int = 50) -> list[dict[str, Any]]:
        if type(limit) is not int or not 1 <= limit <= 50:
            raise BridgeCoreError("EVENT_LIMIT_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            return [dict(row) for row in db.execute(
                "SELECT * FROM inbound_events WHERE status='pending' ORDER BY sequence LIMIT ?",
                (limit,),
            )]

    def ack_events(self, event_ids: Iterable[str]) -> int:
        unique: set[str] = set()
        for index, event_id in enumerate(event_ids):
            if index >= 50:
                raise BridgeCoreError("EVENT_ACK_LIMIT_EXCEEDED")
            unique.add(_uuid(event_id, "EVENT_ID_INVALID"))
        changed = 0
        with self._transaction() as db:
            self._verify_scope(db)
            rows = {}
            for event_id in unique:
                row = db.execute("SELECT status FROM inbound_events WHERE event_id=?", (event_id,)).fetchone()
                if row is None:
                    raise BridgeCoreError("ACK_EVENT_UNKNOWN")
                rows[event_id] = row["status"]
            for event_id, status in rows.items():
                if status == "pending":
                    db.execute("UPDATE inbound_events SET status='acked' WHERE event_id=?", (event_id,))
                    changed += 1
        return changed

    def begin_dispatch(self, command_id: str, *, observed_source_chat_ref: str,
                       observed_peer_ref: str) -> dict[str, Any]:
        command = _uuid(command_id, "COMMAND_ID_INVALID")
        source = _ref(observed_source_chat_ref, "SOURCE_CHAT_REF_INVALID")
        peer = _ref(observed_peer_ref, "PEER_REF_INVALID")
        with self._transaction() as db:
            state = self._verify_scope(db)
            row = db.execute("SELECT * FROM commands WHERE command_id=?", (command,)).fetchone()
            if row is None:
                raise BridgeCoreError("COMMAND_UNKNOWN")
            if row["status"] in TERMINAL_STATES or row["status"] == "dispatch_started":
                return dict(row)
            if row["status"] not in {"accepted", "preparing"}:
                raise BridgeCoreError("COMMAND_STATE_INVALID")
            active = db.execute(
                "SELECT command_id FROM commands WHERE status='dispatch_started' AND command_id<>? LIMIT 1",
                (command,),
            ).fetchone()
            if active is not None:
                raise BridgeCoreError("UI_OPERATION_BUSY")
            chat = db.execute("SELECT * FROM chat_bindings WHERE chat_id=?", (row["chat_id"],)).fetchone()
            error = None
            if not state["account_verified"]:
                error = "ACCOUNT_UNVERIFIED"
            elif not state["receive_healthy"]:
                error = "SOURCE_UNHEALTHY"
            elif chat is None or chat["identity_level"] != "verified":
                error = "PEER_UNVERIFIED"
            elif chat["binding_revision"] != row["binding_revision"]:
                error = "BINDING_REVISION_STALE"
            elif chat["source_chat_ref"] != source or chat["peer_ref"] != peer:
                error = "ACTIVE_PEER_MISMATCH"
            if error:
                db.execute("UPDATE commands SET status='rejected', error_code=? WHERE command_id=?",
                           (error, command))
            else:
                db.execute(
                    "UPDATE commands SET status='dispatch_started', dispatch_count=1 WHERE command_id=?",
                    (command,),
                )
            return dict(db.execute("SELECT * FROM commands WHERE command_id=?", (command,)).fetchone())

    def finish_dispatch(self, command_id: str, *, submitted: bool | None = None,
                        status: str | None = None, error_code: str | None = None) -> dict[str, Any]:
        command = _uuid(command_id, "COMMAND_ID_INVALID")
        if submitted is not None:
            if type(submitted) is not bool or status is not None:
                raise BridgeCoreError("DISPATCH_RESULT_INVALID")
            status = "submitted_unconfirmed" if submitted else "unknown"
        if status not in {"submitted_unconfirmed", "failed", "unknown"}:
            raise BridgeCoreError("DISPATCH_RESULT_INVALID")
        error = None
        if status == "failed":
            error = error_code or "DISPATCH_FAILED"
        elif status == "unknown":
            error = error_code or "DISPATCH_RESULT_UNKNOWN"
        with self._transaction() as db:
            self._verify_scope(db)
            row = db.execute("SELECT * FROM commands WHERE command_id=?", (command,)).fetchone()
            if row is None:
                raise BridgeCoreError("COMMAND_UNKNOWN")
            if row["status"] in TERMINAL_STATES:
                return dict(row)
            if row["status"] != "dispatch_started":
                raise BridgeCoreError("COMMAND_NOT_DISPATCHED")
            db.execute("UPDATE commands SET status=?, error_code=? WHERE command_id=?",
                       (status, error, command))
            return dict(db.execute("SELECT * FROM commands WHERE command_id=?", (command,)).fetchone())

    def recover_interrupted_dispatches(self) -> int:
        """Never repeat a gesture after restart once dispatch may have begun."""
        with self._transaction() as db:
            self._verify_scope(db)
            cursor = db.execute(
                "UPDATE commands SET status='unknown', error_code='DISPATCH_INTERRUPTED' "
                "WHERE status='dispatch_started'"
            )
            return cursor.rowcount


    def list_dispatchable_commands(self, *, limit: int = 10) -> list[dict[str, Any]]:
        if type(limit) is not int or limit < 1 or limit > 50:
            raise BridgeCoreError("COMMAND_LIMIT_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            rows = db.execute(
                "SELECT command_id,client_request_id,chat_id,binding_revision,text "
                "FROM commands WHERE status IN ('accepted', 'preparing') "
                "ORDER BY rowid LIMIT ?",
                (limit,),
            ).fetchall()
            return [{
                "command_id": row["command_id"],
                "client_request_id": row["client_request_id"],
                "bridge_id": self.bridge_id,
                "account_id": self.account_id,
                "account_epoch": self.account_epoch,
                "business_context": self.business_context,
                "chat_id": row["chat_id"],
                "binding_revision": row["binding_revision"],
                "text": row["text"],
            } for row in rows]

    def diagnostics(self) -> dict[str, Any]:
        with self._transaction() as db:
            state = self._verify_scope(db)
            counts = {row[0]: row[1] for row in db.execute(
                "SELECT status, COUNT(*) FROM commands GROUP BY status")}
            verified = db.execute(
                "SELECT COUNT(*) FROM chat_bindings WHERE identity_level='verified' "
                "AND chat_kind='one_to_one'"
            ).fetchone()[0]
            events = {row[0]: row[1] for row in db.execute(
                "SELECT status, COUNT(*) FROM inbound_events GROUP BY status")}
            return {
                "account_verified": bool(state["account_verified"]),
                "receive_healthy": bool(state["receive_healthy"]),
                "send_text": bool(state["account_verified"] and state["receive_healthy"] and verified),
                "verified_one_to_one_chats": verified,
                "inbound_pending": events.get("pending", 0),
                "inbound_acked": events.get("acked", 0),
                "command_counts": {status: counts.get(status, 0) for status in sorted(COMMAND_STATES)},
            }

    def command(self, command_id: str) -> dict[str, Any]:
        command = _uuid(command_id, "COMMAND_ID_INVALID")
        with self._transaction() as db:
            self._verify_scope(db)
            row = db.execute("SELECT * FROM commands WHERE command_id=?", (command,)).fetchone()
            if row is None:
                raise BridgeCoreError("COMMAND_UNKNOWN")
            return dict(row)

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def __enter__(self) -> "BridgeCore":
        return self

    def __exit__(self, *_args) -> None:
        self.close()
