"""Fixed, prepared, metadata-only queries for controlled G3 marker events.

The caller holds one short source read transaction and rescans from the original
durable baseline, including after restart. The returned cursor is progress
metadata, never a replacement for that baseline. This module opens no files,
connections, processes or network clients. Adapter exceptions remain the
caller's responsibility; QueryError contains only a fixed safe diagnostic code.
"""

from __future__ import annotations

import re
from typing import Any, Callable


MAX_SOURCE_ID = (1 << 63) - 1
MAX_EVENTS = 2000
MAX_MARKERS = 5
_MARKER = re.compile(r"EGXG3-[0-9A-F]{8}-(?:DUP|NEW|PHONE|DESKTOP|RENAME)\Z")

MAX_ID_SQL = "SELECT MAX(EventID) FROM Events"
WINDOW_SQL = """
SELECT EventID FROM Events
WHERE EventID > :baseline AND EventID <= :cursor
ORDER BY EventID
LIMIT :row_cap
"""
MARKER_SQL = """
SELECT e.EventID, e.ChatID, e.ContactID, e.Direction,
       (SELECT COUNT(*) FROM Messages mm WHERE mm.EventID = e.EventID),
       (SELECT COUNT(*) FROM Contact cc WHERE cc.ContactID = e.ContactID),
       (SELECT COUNT(*) FROM ChatInfo hh WHERE hh.ChatID = e.ChatID),
       CASE WHEN c.Number IS NOT NULL AND length(c.Number) > 0 THEN 1 ELSE 0 END,
       CASE WHEN ch.Token IS NOT NULL AND length(ch.Token) > 0 THEN 1 ELSE 0 END,
       EXISTS(SELECT 1 FROM Events old
              WHERE old.ChatID = e.ChatID AND old.EventID <= :baseline)
FROM Events e
LEFT JOIN Messages m
  ON m.EventID = e.EventID AND m.Body COLLATE BINARY = :marker
LEFT JOIN Contact c ON c.ContactID = e.ContactID
LEFT JOIN ChatInfo ch ON ch.ChatID = e.ChatID
WHERE e.EventID > :baseline AND e.EventID <= :cursor
  AND m.EventID IS NOT NULL
ORDER BY e.EventID
LIMIT :row_cap
"""


class QueryError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _source_id(value: Any, *, allow_zero: bool = False) -> int:
    minimum = 0 if allow_zero else 1
    if type(value) is not int or not minimum <= value <= MAX_SOURCE_ID:
        raise QueryError("SOURCE_VALUE_UNSUPPORTED")
    return value


def _count(value: Any) -> int:
    if type(value) is not int or not 0 <= value <= MAX_SOURCE_ID:
        raise QueryError("SOURCE_VALUE_UNSUPPORTED")
    return value


def _flag(value: Any) -> bool:
    if type(value) not in (int, bool) or value not in (0, 1):
        raise QueryError("SOURCE_VALUE_UNSUPPORTED")
    return bool(value)


def _rows(read_rows: Callable, sql: str, params: dict,
          column_count: int, row_limit: int) -> list[tuple]:
    rows = read_rows(sql, params, column_count, row_limit)
    if not isinstance(rows, list):
        raise QueryError("SOURCE_VALUE_UNSUPPORTED")
    if len(rows) > row_limit:
        raise QueryError("WINDOW_OVERFLOW")
    if any(not isinstance(row, tuple) or len(row) != column_count for row in rows):
        raise QueryError("SOURCE_VALUE_UNSUPPORTED")
    return rows


def scan_window(read_rows: Callable, baseline: int, markers: list[str],
                max_events: int = MAX_EVENTS) -> dict:
    """Observe exact markers without returning any source message/contact text."""
    _source_id(baseline, allow_zero=True)
    if (type(max_events) is not int or not 1 <= max_events <= MAX_EVENTS
            or not isinstance(markers, list) or not 1 <= len(markers) <= MAX_MARKERS
            or any(type(marker) is not str or not _MARKER.fullmatch(marker) for marker in markers)
            or len(set(markers)) != len(markers)):
        raise QueryError("SOURCE_VALUE_UNSUPPORTED")

    maximum = _rows(read_rows, MAX_ID_SQL, {}, 1, 1)
    if len(maximum) != 1:
        raise QueryError("SOURCE_VALUE_UNSUPPORTED")
    cursor = 0 if maximum[0][0] is None else _source_id(maximum[0][0])
    if cursor < baseline:
        raise QueryError("SOURCE_REGRESSED")
    cap = max_events + 1
    window = _rows(read_rows, WINDOW_SQL,
                   {"baseline": baseline, "cursor": cursor, "row_cap": cap}, 1, cap)
    window_ids: set[int] = set()
    previous = baseline
    for (value,) in window:
        event_id = _source_id(value)
        if event_id in window_ids:
            raise QueryError("CARDINALITY_AMBIGUOUS")
        if not baseline < event_id <= cursor or event_id < previous:
            raise QueryError("SOURCE_REGRESSED")
        window_ids.add(event_id)
        previous = event_id
    if len(window_ids) > max_events:
        raise QueryError("WINDOW_OVERFLOW")
    # Within one transaction, MAX must belong to the selected nonempty window.
    if cursor > baseline and cursor not in window_ids:
        raise QueryError("SOURCE_REGRESSED")

    observations = []
    matched_ids: set[int] = set()
    pending_ids: set[int] = set()
    for marker in markers:
        params = {"baseline": baseline, "cursor": cursor, "marker": marker, "row_cap": cap}
        matches = _rows(read_rows, MARKER_SQL, params, 10, cap)
        for row in matches:
            (event_id, chat_id, contact_id, direction, messages, contacts,
             chats, number_present, token_present, old_chat) = row
            event_id = _source_id(event_id)
            if event_id not in window_ids:
                raise QueryError("SOURCE_REGRESSED")
            if event_id in matched_ids:
                raise QueryError("CARDINALITY_AMBIGUOUS")
            matched_ids.add(event_id)
            messages, contacts, chats = _count(messages), _count(contacts), _count(chats)
            if max(messages, contacts, chats) > 1:
                raise QueryError("CARDINALITY_AMBIGUOUS")
            if messages != 1:
                raise QueryError("SOURCE_VALUE_UNSUPPORTED")
            if chat_id is not None:
                _source_id(chat_id)
            if contact_id is not None:
                _source_id(contact_id)
            number_present = _flag(number_present)
            token_present = _flag(token_present)
            old_chat = _flag(old_chat)
            if contacts == 0 or chats == 0 or chat_id is None or contact_id is None:
                pending_ids.add(event_id)
                continue
            observations.append({
                "source_event_id": event_id,
                "chat_id": chat_id,
                "contact_id": contact_id,
                "marker": marker,
                "direction_code": direction if type(direction) is int and 0 <= direction <= 3 else None,
                "number_present": number_present,
                "token_present": token_present,
                "chat_had_events_before_baseline": old_chat,
            })
        if len(matches) > max_events:
            raise QueryError("WINDOW_OVERFLOW")

    observations.sort(key=lambda item: item["source_event_id"])
    return {"cursor": cursor, "window_count": len(window_ids),
            "observations": observations, "pending_relations": len(pending_ids)}
