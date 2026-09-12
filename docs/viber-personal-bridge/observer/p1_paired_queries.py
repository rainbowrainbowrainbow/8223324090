"""Prepared queries for one live chat anchored by controlled direction markers.

This module opens no database and emits no logs. Message text may be returned to
the caller for immediate durable ingestion, so callers must never print results.
"""

from __future__ import annotations

import re
from typing import Any, Callable


MAX_ID = (1 << 63) - 1
MAX_TEXT = 4000
MAX_BATCH = 50
_MARKER = re.compile(r"EGXG3-[0-9A-F]{8}-(?:PHONE|DESKTOP)\Z")

ANCHOR_SQL = """
SELECT e.EventID, e.ChatID, e.ContactID, e.Direction
FROM Events e
JOIN Messages m ON m.EventID = e.EventID
WHERE m.Body COLLATE BINARY = :marker
ORDER BY e.EventID
LIMIT 2
"""

INBOUND_SQL = """
SELECT e.EventID, e.ChatID, e.ContactID, e.Direction, m.Body
FROM Events e
JOIN Messages m ON m.EventID = e.EventID
WHERE e.ChatID = :chat_id AND e.Direction = :direction
  AND e.EventID > :after_event_id
ORDER BY e.EventID
LIMIT :row_cap
"""

RECONCILE_SQL = """
SELECT e.EventID, e.ChatID, e.Direction
FROM Events e
JOIN Messages m ON m.EventID = e.EventID
WHERE m.Body COLLATE BINARY = :text
ORDER BY e.EventID
LIMIT 2
"""

LATEST_INBOUND_SQL = """
SELECT e.EventID, e.ChatID, e.ContactID, e.Direction, m.Body
FROM Events e
JOIN Messages m ON m.EventID = e.EventID
WHERE e.ChatID = :chat_id AND e.Direction = :direction
  AND m.Body NOT GLOB 'EGXG3-*' AND m.Body NOT GLOB 'EGXP1-*'
ORDER BY e.EventID DESC
LIMIT 1
"""

SEEDED_OUTBOUND_SQL = """
SELECT e.EventID, e.ChatID, e.Direction
FROM Events e
JOIN Messages m ON m.EventID = e.EventID
WHERE m.Body COLLATE BINARY = :text
  AND e.EventID > :after_event_id
ORDER BY e.EventID
LIMIT 2
"""

SEEDED_REPLY_SQL = """
SELECT e.EventID, e.ChatID, e.ContactID, e.Direction, m.Body
FROM Events e
JOIN Messages m ON m.EventID = e.EventID
WHERE e.ChatID = :chat_id AND e.Direction = :direction
  AND e.EventID > :after_event_id
ORDER BY e.EventID DESC
LIMIT 1
"""


class PairedQueryError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _id(value: Any) -> int:
    if type(value) is not int or not 1 <= value <= MAX_ID:
        raise PairedQueryError("SOURCE_VALUE_UNSUPPORTED")
    return value


def _rows(reader: Callable, sql: str, params: dict, columns: int, limit: int) -> list[tuple]:
    rows = reader(sql, params, columns, limit)
    if (not isinstance(rows, list) or len(rows) > limit
            or any(not isinstance(row, tuple) or len(row) != columns for row in rows)):
        raise PairedQueryError("SOURCE_VALUE_UNSUPPORTED")
    return rows


def resolve_anchor(reader: Callable, phone_marker: str, desktop_marker: str) -> dict[str, int]:
    if (not isinstance(phone_marker, str) or not isinstance(desktop_marker, str)
            or _MARKER.fullmatch(phone_marker) is None or _MARKER.fullmatch(desktop_marker) is None
            or not phone_marker.endswith("-PHONE") or not desktop_marker.endswith("-DESKTOP")
            or phone_marker.rsplit("-", 1)[0] != desktop_marker.rsplit("-", 1)[0]):
        raise PairedQueryError("MARKER_INVALID")
    phone = _rows(reader, ANCHOR_SQL, {"marker": phone_marker}, 4, 2)
    desktop = _rows(reader, ANCHOR_SQL, {"marker": desktop_marker}, 4, 2)
    if len(phone) != 1 or len(desktop) != 1:
        raise PairedQueryError("ANCHOR_AMBIGUOUS")
    phone_event, phone_chat, phone_peer, inbound = phone[0]
    desktop_event, desktop_chat, _desktop_contact, outbound = desktop[0]
    values = [_id(value) for value in (phone_event, phone_chat, phone_peer, desktop_event, desktop_chat)]
    if (type(inbound) is not int or type(outbound) is not int or inbound == outbound
            or not 0 <= inbound <= 3 or not 0 <= outbound <= 3 or values[1] != values[4]):
        raise PairedQueryError("DIRECTION_ANCHOR_INVALID")
    return {"chat_id": values[1], "peer_contact_id": values[2], "inbound_code": inbound,
            "outbound_code": outbound, "anchor_event_id": max(values[0], values[3])}


def scan_inbound(reader: Callable, anchor: dict[str, int], after_event_id: int,
                 limit: int = MAX_BATCH) -> list[dict[str, Any]]:
    expected = {"chat_id", "peer_contact_id", "inbound_code", "outbound_code", "anchor_event_id"}
    if (not isinstance(anchor, dict) or set(anchor) != expected or type(limit) is not int
            or not 1 <= limit <= MAX_BATCH):
        raise PairedQueryError("ANCHOR_INVALID")
    chat_id = _id(anchor["chat_id"])
    peer = _id(anchor["peer_contact_id"])
    start = _id(after_event_id)
    if start < _id(anchor["anchor_event_id"]):
        raise PairedQueryError("CURSOR_BEFORE_ANCHOR")
    inbound = anchor["inbound_code"]
    if type(inbound) is not int or not 0 <= inbound <= 3:
        raise PairedQueryError("ANCHOR_INVALID")
    rows = _rows(reader, INBOUND_SQL, {"chat_id": chat_id, "direction": inbound,
                                      "after_event_id": start, "row_cap": limit + 1}, 5, limit + 1)
    if len(rows) > limit:
        raise PairedQueryError("BATCH_OVERFLOW")
    result = []
    previous = start
    for event_id, row_chat, contact_id, direction, body in rows:
        event_id, row_chat, contact_id = _id(event_id), _id(row_chat), _id(contact_id)
        if (event_id <= previous or row_chat != chat_id or contact_id != peer or direction != inbound):
            raise PairedQueryError("PAIRED_IDENTITY_CHANGED")
        if not isinstance(body, str) or not body or len(body) > MAX_TEXT or "\x00" in body:
            raise PairedQueryError("MESSAGE_UNSUPPORTED")
        result.append({"source_event_id": event_id, "text": body})
        previous = event_id
    return result


def reconcile_outbound(reader: Callable, anchor: dict[str, int], exact_text: str) -> dict[str, Any]:
    if (not isinstance(anchor, dict) or set(anchor) != {"chat_id", "peer_contact_id", "inbound_code",
                                                        "outbound_code", "anchor_event_id"}
            or not isinstance(exact_text, str) or not exact_text or len(exact_text) > 500
            or "\x00" in exact_text or "\r" in exact_text):
        raise PairedQueryError("RECONCILE_ARGUMENT_INVALID")
    rows = _rows(reader, RECONCILE_SQL, {"text": exact_text}, 3, 2)
    if len(rows) > 1:
        raise PairedQueryError("RECONCILE_AMBIGUOUS")
    if not rows:
        return {"observed": False}
    event_id, chat_id, direction = rows[0]
    if (_id(event_id) <= _id(anchor["anchor_event_id"]) or _id(chat_id) != _id(anchor["chat_id"])
            or direction != anchor["outbound_code"]):
        raise PairedQueryError("RECONCILE_IDENTITY_MISMATCH")
    return {"observed": True}


def latest_inbound(reader: Callable, anchor: dict[str, int]) -> str | None:
    rows = _rows(reader, LATEST_INBOUND_SQL,
                 {"chat_id": _id(anchor["chat_id"]), "direction": anchor["inbound_code"]}, 5, 1)
    if not rows:
        return None
    _event_id, chat_id, contact_id, direction, body = rows[0]
    if (_id(chat_id) != _id(anchor["chat_id"]) or _id(contact_id) != _id(anchor["peer_contact_id"])
            or direction != anchor["inbound_code"]):
        raise PairedQueryError("PAIRED_IDENTITY_CHANGED")
    if not isinstance(body, str) or not body or len(body) > MAX_TEXT or "\x00" in body:
        raise PairedQueryError("MESSAGE_UNSUPPORTED")
    return body


def latest_seeded_reply(reader: Callable, direction_anchor: dict[str, int],
                        exact_outbound_text: str) -> str | None:
    expected = {"chat_id", "peer_contact_id", "inbound_code", "outbound_code",
                "anchor_event_id"}
    if (not isinstance(direction_anchor, dict) or set(direction_anchor) != expected
            or not isinstance(exact_outbound_text, str) or not exact_outbound_text
            or len(exact_outbound_text) > 500 or "\x00" in exact_outbound_text
            or "\r" in exact_outbound_text):
        raise PairedQueryError("SEEDED_ARGUMENT_INVALID")
    anchor_event_id = _id(direction_anchor["anchor_event_id"])
    seed_rows = _rows(reader, SEEDED_OUTBOUND_SQL,
                      {"text": exact_outbound_text, "after_event_id": anchor_event_id}, 3, 2)
    if len(seed_rows) != 1:
        raise PairedQueryError("SEEDED_OUTBOUND_AMBIGUOUS")
    seed_event, chat_id, direction = seed_rows[0]
    seed_event, chat_id = _id(seed_event), _id(chat_id)
    if (seed_event <= anchor_event_id
            or direction != direction_anchor["outbound_code"]):
        raise PairedQueryError("SEEDED_OUTBOUND_INVALID")
    rows = _rows(reader, SEEDED_REPLY_SQL,
                 {"chat_id": chat_id, "direction": direction_anchor["inbound_code"],
                  "after_event_id": seed_event}, 5, 1)
    if not rows:
        return None
    event_id, row_chat, contact_id, reply_direction, body = rows[0]
    if (_id(event_id) <= seed_event or _id(row_chat) != chat_id or _id(contact_id) < 1
            or reply_direction != direction_anchor["inbound_code"]):
        raise PairedQueryError("SEEDED_REPLY_IDENTITY_CHANGED")
    if not isinstance(body, str) or not body or len(body) > MAX_TEXT or "\x00" in body:
        raise PairedQueryError("MESSAGE_UNSUPPORTED")
    return body
