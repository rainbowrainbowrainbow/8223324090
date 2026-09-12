"""Read one reply from the unique chat containing an exact controlled outbound text."""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import stat
import sys

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


def result(status, code="", text=None, reveal=False):
    value = {
        "status": status, "error_code": code, "reply_observed": text is not None,
        "same_chat_verified": text is not None, "direction_verified": text is not None,
        "private_text_exported": bool(reveal and text is not None),
        "identifiers_exported": False, "messages_sent": 0, "crm_contacted": False,
    }
    if reveal:
        value["latest_inbound_text"] = text
    return value


def run(session_path, exact_text, reveal=False):
    context = db = lock = guard = None
    connection_name = None
    try:
        session = g3_state.load_session(session_path)
        lock = lock_session(g3_state, session_path)
        guard = g3_process.capture(probe_key_presence)
        if not guard.alive():
            return result("FAILED", "TARGET_UNAVAILABLE")
        context = qt_readonly_fixture.initialize_qt(session["bindings_path"])
        if qt_readonly_fixture.run_fixture(context)["status"] != "PASS":
            return result("FAILED", "SOURCE_UNAVAILABLE")
        path = source_path()
        identity = source_identity(path)
        candidate = recover_sid_key.derive(recover_sid_key.static_prefix(), recover_sid_key.current_sid())
        db, connection_name = open_source(context, qt_readonly_fixture, probe_db_schema, path, [candidate])
        candidate = b""
        rows = QtRows(context, db)
        prefix = "EGXG3-" + session["run_id"]
        if not db.transaction():
            return result("FAILED", "SOURCE_UNAVAILABLE")
        try:
            direction_anchor = p1_paired_queries.resolve_anchor(
                rows, prefix + "-PHONE", prefix + "-DESKTOP")
            text = p1_paired_queries.latest_seeded_reply(rows, direction_anchor, exact_text)
        finally:
            if not db.rollback():
                return result("FAILED", "SOURCE_UNAVAILABLE")
        if source_identity(path) != identity or source_path() != path or not guard.alive():
            return result("FAILED", "SOURCE_CHANGED")
        return result("SEEDED_REPLY_VERIFIED" if text is not None else "NO_REPLY", text=text,
                      reveal=reveal)
    except Exception:
        return result("FAILED", "SEEDED_REPLY_READ_FAILED")
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


if __name__ == "__main__":
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--text-base64", required=True)
    parser.add_argument("--reveal-latest", action="store_true")
    try:
        args = parser.parse_args()
        expected = base64.b64decode(args.text_base64, validate=True).decode("utf-8")
        valid = 0 < len(expected) <= 500 and all(c not in expected for c in "\0\r\n")
        output = run(find_single_session(), expected, args.reveal_latest) if valid else result(
            "FAILED", "ARGUMENT_INVALID")
    except BaseException:
        output = result("FAILED", "ARGUMENT_INVALID")
    print(json.dumps(output, separators=(",", ":")), flush=True)
