"""Adapter from the existing marker-only G3 journal into the P1 outbox.

The adapter accepts only the redacted G3 journal shape. It does not access the
Viber database, CRM, network or UI and cannot enable Send.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, Iterable, Mapping

from p1_bridge_core import BridgeCore, BridgeCoreError


class G3AdapterError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


_G3_FIELDS = {"source_event_id", "event_id", "chat_ref", "peer_ref", "marker",
              "direction_code", "status"}


def _source_event_ref(secret: bytes, source_event_id: int) -> str:
    if not isinstance(secret, bytes) or len(secret) < 32:
        raise G3AdapterError("REFERENCE_KEY_INVALID")
    if type(source_event_id) is not int or source_event_id < 1:
        raise G3AdapterError("SOURCE_EVENT_ID_INVALID")
    return hmac.new(secret, b"p1-source-event\0" + str(source_event_id).encode("ascii"),
                    hashlib.sha256).hexdigest()


def import_pending(core: BridgeCore, rows: Iterable[Mapping[str, Any]], *,
                   reference_key: bytes, observed_at: str,
                   direction_map: Mapping[int, str] | None = None) -> list[dict[str, Any]]:
    """Import G3 occurrences idempotently; keep direction unknown until proven."""
    if not isinstance(core, BridgeCore):
        raise G3AdapterError("CORE_INVALID")
    mapping = {} if direction_map is None else dict(direction_map)
    if any(type(code) is not int or direction not in {"inbound", "outbound"}
           for code, direction in mapping.items()):
        raise G3AdapterError("DIRECTION_MAP_INVALID")
    imported = []
    seen: set[int] = set()
    for index, row in enumerate(rows):
        if index >= 50:
            raise G3AdapterError("IMPORT_LIMIT_EXCEEDED")
        if not isinstance(row, Mapping) or set(row) != _G3_FIELDS:
            raise G3AdapterError("G3_ROW_SHAPE_INVALID")
        source_event_id = row["source_event_id"]
        if type(source_event_id) is not int or source_event_id < 1 or source_event_id in seen:
            raise G3AdapterError("SOURCE_EVENT_ID_INVALID")
        seen.add(source_event_id)
        if row["status"] not in {"pending", "acked"}:
            raise G3AdapterError("G3_STATUS_INVALID")
        if not isinstance(row["marker"], str) or not row["marker"].startswith("EGXG3-"):
            raise G3AdapterError("G3_MARKER_INVALID")
        direction_code = row["direction_code"]
        if direction_code is not None and (type(direction_code) is not int or direction_code not in (0, 1, 2, 3)):
            raise G3AdapterError("DIRECTION_CODE_INVALID")
        direction = mapping.get(direction_code, "unknown")
        origin = "external_viber" if direction == "inbound" else "unknown"
        try:
            chat = core.discover_source_chat(source_chat_ref=row["chat_ref"], peer_ref=row["peer_ref"])
            event = core.ingest_observation({
                "source_event_ref": _source_event_ref(reference_key, source_event_id),
                "source_chat_ref": row["chat_ref"],
                "peer_ref": row["peer_ref"],
                "direction": direction,
                "origin": origin,
                "text": row["marker"],
                "observed_at": observed_at,
            })
        except BridgeCoreError as error:
            raise G3AdapterError(error.code) from None
        if event["chat_id"] != chat["chat_id"]:
            raise G3AdapterError("CHAT_IDENTITY_CONFLICT")
        imported.append(event)
    return imported
