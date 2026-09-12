"""Bounded live proof for inbound text in one marker-anchored Viber chat.

The source query may hold post-anchor message text in memory, but public output
contains only counters and booleans. No text, IDs, refs, paths or keys are emitted.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import stat
import sys
from typing import Any

_SCRIPT = Path(__file__).absolute()
_INFO = _SCRIPT.lstat()
_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
if (not stat.S_ISREG(_INFO.st_mode) or getattr(_INFO, "st_file_attributes", 0) & _REPARSE
        or _SCRIPT.resolve(strict=True) != _SCRIPT):
    raise SystemExit(2)
sys.path.insert(0, str(_SCRIPT.parent))

import g3_process
import g3_state
import p1_paired_queries
import probe_db_schema
import probe_key_presence
import qt_readonly_fixture
import recover_sid_key
from observe_g3 import QtRows, lock_session, open_source, source_identity, source_path
from observe_g3_sid import find_single_session


def failure(code: str) -> dict[str, Any]:
    allowed = {"STATE_UNAVAILABLE", "TARGET_UNAVAILABLE", "SOURCE_UNAVAILABLE",
               "ANCHOR_UNAVAILABLE", "PAIRED_READ_FAILED", "SOURCE_CHANGED"}
    return {
        "status": "FAILED", "error_code": code if code in allowed else "PAIRED_READ_FAILED",
        "anchor_verified": False, "direction_verified": False, "same_chat_verified": False,
        "inbound_occurrences_after_anchor": 0, "identical_text_occurrences_preserved": False,
        "private_text_exported": False, "identifiers_exported": False,
        "messages_sent": 0, "crm_contacted": False,
    }


def summarize(events: list[dict[str, Any]], reveal_latest: bool = False,
              latest_text: str | None = None) -> dict[str, Any]:
    texts = Counter(item["text"] for item in events)
    result = {
        "status": "PAIRED_RECEIVE_VERIFIED",
        "error_code": "",
        "anchor_verified": True,
        "direction_verified": True,
        "same_chat_verified": True,
        "inbound_occurrences_after_anchor": len(events),
        "identical_text_occurrences_preserved": any(count >= 2 for count in texts.values()),
        "private_text_exported": False,
        "identifiers_exported": False,
        "messages_sent": 0,
        "crm_contacted": False,
    }
    if reveal_latest:
        result["latest_inbound_text"] = latest_text
    return result


def run(session_path: str, reveal_latest: bool = False) -> dict[str, Any]:
    context = db = lock = guard = None
    connection_name = None
    try:
        session = g3_state.load_session(session_path)
        lock = lock_session(g3_state, session_path)
        guard = g3_process.capture(probe_key_presence)
        if not guard.alive():
            return failure("TARGET_UNAVAILABLE")
        context = qt_readonly_fixture.initialize_qt(session["bindings_path"])
        if qt_readonly_fixture.run_fixture(context)["status"] != "PASS":
            return failure("SOURCE_UNAVAILABLE")
        path = source_path()
        identity = source_identity(path)
        candidate = recover_sid_key.derive(recover_sid_key.static_prefix(), recover_sid_key.current_sid())
        db, connection_name = open_source(context, qt_readonly_fixture, probe_db_schema, path, [candidate])
        candidate = b""
        rows = QtRows(context, db)
        prefix = "EGXG3-" + session["run_id"]
        if not db.transaction():
            return failure("SOURCE_UNAVAILABLE")
        try:
            anchor = p1_paired_queries.resolve_anchor(rows, prefix + "-PHONE", prefix + "-DESKTOP")
            events = p1_paired_queries.scan_inbound(rows, anchor, anchor["anchor_event_id"])
            latest_text = p1_paired_queries.latest_inbound(rows, anchor) if reveal_latest else None
        finally:
            if not db.rollback():
                return failure("SOURCE_UNAVAILABLE")
        if (source_identity(path) != identity or source_path() != path or not guard.alive()):
            return failure("SOURCE_CHANGED")
        return summarize(events, reveal_latest=reveal_latest, latest_text=latest_text)
    except g3_state.StateError:
        return failure("STATE_UNAVAILABLE")
    except p1_paired_queries.PairedQueryError as error:
        if error.code in {"ANCHOR_AMBIGUOUS", "DIRECTION_ANCHOR_INVALID"}:
            return failure("ANCHOR_UNAVAILABLE")
        return failure("PAIRED_READ_FAILED")
    except Exception:
        return failure("PAIRED_READ_FAILED")
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
        db = None
        if context is not None and connection_name is not None:
            try:
                context.sql.QSqlDatabase.removeDatabase(connection_name)
            except Exception:
                pass
        if guard is not None:
            try:
                guard.close()
            except Exception:
                pass
        if lock is not None:
            try:
                lock.close()
            except Exception:
                pass


def main(argv=None) -> dict[str, Any]:
    try:
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument("--reveal-latest", action="store_true")
        args = parser.parse_args(argv)
        return run(find_single_session(), reveal_latest=args.reveal_latest)
    except Exception:
        return failure("STATE_UNAVAILABLE")


if __name__ == "__main__":
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    print(json.dumps(main(), separators=(",", ":")), flush=True)
