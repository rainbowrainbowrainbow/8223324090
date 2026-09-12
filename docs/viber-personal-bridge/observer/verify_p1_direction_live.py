"""Verify the controlled PHONE/DESKTOP direction pair in the private G3 journal.

Only exact synthetic markers are queried. The public result contains counts,
direction codes and equality flags; it never exports IDs, refs, paths or text.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import stat
import sys
from typing import Any, Callable

_SCRIPT = Path(__file__).absolute()
_INFO = _SCRIPT.lstat()
_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
if (not stat.S_ISREG(_INFO.st_mode) or getattr(_INFO, "st_file_attributes", 0) & _REPARSE
        or _SCRIPT.resolve(strict=True) != _SCRIPT):
    raise SystemExit(2)
sys.path.insert(0, str(_SCRIPT.parent))

import g3_journal
import g3_state
from observe_g3_sid import find_single_session


def failure(code: str) -> dict[str, Any]:
    allowed = {"STATE_UNAVAILABLE", "JOURNAL_UNAVAILABLE", "JOURNAL_INVALID", "WORKER_FAILED"}
    return {
        "status": "FAILED",
        "error_code": code if code in allowed else "WORKER_FAILED",
        "direction_verified": False,
        "inbound_code": None,
        "outbound_code": None,
        "phone_count": 0,
        "desktop_count": 0,
        "same_chat": False,
        "private_text_exported": False,
        "identifiers_exported": False,
        "messages_sent": 0,
        "crm_contacted": False,
    }


def verify(session_path: str, *, session_loader: Callable = g3_state.load_session,
           path_provider: Callable = g3_state.journal_path,
           connect: Callable = sqlite3.connect) -> dict[str, Any]:
    try:
        session = session_loader(session_path)
        run_id = session.get("run_id") if isinstance(session, dict) else None
        if not isinstance(run_id, str) or g3_state.RUN_PATTERN.fullmatch(run_id) is None:
            return failure("STATE_UNAVAILABLE")
        phone_marker = f"EGXG3-{run_id}-PHONE"
        desktop_marker = f"EGXG3-{run_id}-DESKTOP"
        path = path_provider(session_path)
        before = path.stat()
        if (not stat.S_ISREG(before.st_mode)
                or getattr(before, "st_file_attributes", 0) & _REPARSE
                or before.st_nlink != 1):
            return failure("JOURNAL_INVALID")
        db = connect(path.as_uri() + "?mode=ro", uri=True)
        try:
            app_id = db.execute("PRAGMA application_id").fetchone()[0]
            version = db.execute("PRAGMA user_version").fetchone()[0]
            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if (app_id != g3_journal.APPLICATION_ID or version != g3_journal.SCHEMA_VERSION
                    or tables != {"source_state", "events"}):
                return failure("JOURNAL_INVALID")
            rows = list(db.execute(
                "SELECT marker, direction_code, chat_ref FROM events WHERE marker IN (?, ?)",
                (phone_marker, desktop_marker)))
        finally:
            db.close()
        after = path.stat()
        if ((before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)):
            return failure("JOURNAL_INVALID")
        phone = [row for row in rows if row[0].endswith("-PHONE")]
        desktop = [row for row in rows if row[0].endswith("-DESKTOP")]
        valid = (len(phone) == 1 and len(desktop) == 1
                 and type(phone[0][1]) is int and type(desktop[0][1]) is int
                 and phone[0][1] != desktop[0][1] and phone[0][2] == desktop[0][2])
        return {
            "status": "DIRECTION_VERIFIED" if valid else "DIRECTION_NOT_VERIFIED",
            "error_code": "",
            "direction_verified": valid,
            "inbound_code": phone[0][1] if len(phone) == 1 and type(phone[0][1]) is int else None,
            "outbound_code": desktop[0][1] if len(desktop) == 1 and type(desktop[0][1]) is int else None,
            "phone_count": len(phone),
            "desktop_count": len(desktop),
            "same_chat": len(phone) == 1 and len(desktop) == 1 and phone[0][2] == desktop[0][2],
            "private_text_exported": False,
            "identifiers_exported": False,
            "messages_sent": 0,
            "crm_contacted": False,
        }
    except g3_state.StateError:
        return failure("STATE_UNAVAILABLE")
    except sqlite3.Error:
        return failure("JOURNAL_UNAVAILABLE")
    except Exception:
        return failure("WORKER_FAILED")


def main() -> dict[str, Any]:
    try:
        return verify(find_single_session())
    except Exception:
        return failure("STATE_UNAVAILABLE")


if __name__ == "__main__":
    print(json.dumps(main(), separators=(",", ":")), flush=True)
