"""Bounded read-only P1 account verification for the current Viber profile.

The expected E.164 value is read from stdin and never emitted. The script does
not open viber.db, query messages, navigate UI, contact CRM or send anything.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
import sys
from typing import Any, Callable

# Python -I omits the script directory. Admit only this verified sibling tree.
_SCRIPT = Path(__file__).absolute()
_INFO = _SCRIPT.lstat()
_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
if (not stat.S_ISREG(_INFO.st_mode) or getattr(_INFO, "st_file_attributes", 0) & _REPARSE
        or _SCRIPT.resolve(strict=True) != _SCRIPT):
    raise SystemExit(2)
sys.path.insert(0, str(_SCRIPT.parent))

import g3_process
import g3_state
import p1_account_identity
import probe_key_presence
import recover_sid_key


def public_failure(code: str) -> dict[str, Any]:
    allowed = {
        "ACCOUNT_INPUT_INVALID", "STATE_UNAVAILABLE", "TARGET_UNAVAILABLE",
        "STATE_PATH_REJECTED", "STATE_MISSING", "STATE_READ_FAILED", "STATE_CORRUPT",
        "STATE_VERSION_UNSUPPORTED", "STATE_DPAPI_FAILED", "STATE_BINDINGS_UNAVAILABLE",
        "STATE_SESSION_ROOT_REJECTED", "STATE_SESSION_LOAD_REJECTED",
        "STATE_BASE_REJECTED", "STATE_ARGUMENT_REJECTED", "STATE_IDENTITY_REJECTED",
        "STATE_DIRECTORY_REJECTED",
        "SOURCE_CHANGED", "ACCOUNT_SOURCE_UNAVAILABLE", "ACCOUNT_SOURCE_REJECTED",
        "ACCOUNT_SOURCE_NOT_UNIQUE", "ACCOUNT_IDENTITY_MISMATCH", "PLATFORM_UNSUPPORTED",
        "WORKER_FAILED",
    }
    return {
        "protocol_version": "1.0",
        "status": "FAILED",
        "error_code": code if code in allowed else "WORKER_FAILED",
        "account_verified": False,
        "process_verified": False,
        "source_continuity_verified": False,
        "account_value_exported": False,
        "database_opened": False,
        "messages_queried": False,
        "messages_sent": 0,
    }


def read_expected(stream) -> str:
    raw = stream.readline(19)
    if type(raw) is not bytes or not raw.endswith(b"\n") or len(raw) > 17:
        raise ValueError("ACCOUNT_INPUT_INVALID")
    try:
        value = raw[:-1].decode("ascii")
    except UnicodeDecodeError:
        raise ValueError("ACCOUNT_INPUT_INVALID") from None
    if b"\r" in raw or not value:
        raise ValueError("ACCOUNT_INPUT_INVALID")
    return value


def read_expected_hidden(get_character=None) -> str:
    """Read one E.164 line from a Windows console without terminal echo."""
    if get_character is None:
        import msvcrt
        get_character = msvcrt.getwch
    characters = []
    for _ in range(18):
        value = get_character()
        if not isinstance(value, str) or len(value) != 1:
            raise ValueError("ACCOUNT_INPUT_INVALID")
        if value in {"\r", "\n"}:
            if not characters:
                raise ValueError("ACCOUNT_INPUT_INVALID")
            return "".join(characters)
        if ord(value) < 32 or ord(value) > 126:
            raise ValueError("ACCOUNT_INPUT_INVALID")
        characters.append(value)
    raise ValueError("ACCOUNT_INPUT_INVALID")


def find_single_session() -> str:
    try:
        base = g3_state._base_directory()
        candidates = [item for item in base.iterdir()
                      if item.is_dir() and g3_state.DIRECTORY_PATTERN.fullmatch(item.name)]
        if len(candidates) != 1:
            raise g3_state.StateError("STATE_PATH_REJECTED")
        return str(g3_state._existing_directory(candidates[0]))
    except g3_state.StateError:
        raise
    except Exception:
        raise g3_state.StateError("STATE_PATH_REJECTED") from None


def verify(session_path: str, expected_e164: str, *, load_session: Callable = g3_state.load_session,
           capture: Callable = g3_process.capture, account_path: Callable = recover_sid_key.account_path,
           verify_account: Callable = p1_account_identity.verify_current_account) -> dict[str, Any]:
    guard = None
    stage = "state_base"
    try:
        if load_session is g3_state.load_session:
            base = g3_state._base_directory()
            stage = "state_argument"
            candidate = g3_state._absolute_path(session_path)
            stage = "state_identity"
            if (not g3_state.DIRECTORY_PATTERN.fullmatch(candidate.name)
                    or not g3_state._same_path(candidate.parent, base)):
                raise g3_state.StateError("STATE_PATH_REJECTED")
            stage = "state_directory"
            g3_state._existing_directory(candidate)
        stage = "state_load"
        session = load_session(session_path)
        if not isinstance(session, dict) or not isinstance(session.get("hmac_key"), bytes):
            return public_failure("STATE_UNAVAILABLE")
        stage = "source"
        before = account_path()
        before_info = before.stat()
        before_identity = (before_info.st_dev, before_info.st_ino)
        stage = "process"
        guard = capture(probe_key_presence)
        if not guard.alive():
            return public_failure("TARGET_UNAVAILABLE")
        stage = "identity"
        proof = verify_account(expected_e164, session["hmac_key"])
        stage = "continuity"
        after = account_path()
        after_info = after.stat()
        continuity = (before == after and before_identity == (after_info.st_dev, after_info.st_ino)
                      and guard.alive())
        if not continuity:
            return public_failure("SOURCE_CHANGED")
        required = {
            "account_verified", "proof_method", "account_ref", "source_generation_ref",
            "account_value_exported", "database_opened", "messages_queried",
        }
        if not isinstance(proof, dict) or set(proof) != required or proof["account_verified"] is not True:
            return public_failure("WORKER_FAILED")
        return {
            "protocol_version": "1.0",
            "status": "ACCOUNT_VERIFIED",
            "error_code": "",
            "account_verified": True,
            "process_verified": True,
            "source_continuity_verified": True,
            "proof_method": proof["proof_method"],
            "account_ref": proof["account_ref"],
            "source_generation_ref": proof["source_generation_ref"],
            "account_value_exported": False,
            "database_opened": False,
            "messages_queried": False,
            "messages_sent": 0,
        }
    except g3_state.StateError as error:
        if error.code == "STATE_PATH_REJECTED":
            stages = {
                "state_base": "STATE_BASE_REJECTED",
                "state_argument": "STATE_ARGUMENT_REJECTED",
                "state_identity": "STATE_IDENTITY_REJECTED",
                "state_directory": "STATE_DIRECTORY_REJECTED",
                "state_load": "STATE_SESSION_LOAD_REJECTED",
            }
            code = stages.get(stage, "STATE_SESSION_ROOT_REJECTED")
            return public_failure(code)
        return public_failure(error.code)
    except p1_account_identity.AccountIdentityError as error:
        return public_failure(error.code)
    except Exception as error:
        fixed = {
            "state_base": "STATE_UNAVAILABLE",
            "state_argument": "STATE_UNAVAILABLE",
            "state_identity": "STATE_UNAVAILABLE",
            "state_directory": "STATE_UNAVAILABLE",
            "state_load": "STATE_UNAVAILABLE",
            "source": "ACCOUNT_SOURCE_UNAVAILABLE",
            "process": "TARGET_UNAVAILABLE",
            "identity": "WORKER_FAILED",
            "continuity": "SOURCE_CHANGED",
        }
        code = str(error) if str(error) in {"ACCOUNT_INPUT_INVALID"} else fixed.get(stage, "WORKER_FAILED")
        return public_failure(code)
    finally:
        if guard is not None:
            try:
                guard.close()
            except Exception:
                pass


def main(argv=None, stream=None) -> dict[str, Any]:
    try:
        parser = argparse.ArgumentParser(add_help=False)
        sessions = parser.add_mutually_exclusive_group(required=True)
        sessions.add_argument("--session")
        sessions.add_argument("--auto-session", action="store_true")
        args = parser.parse_args(argv)
        if stream is not None:
            expected = read_expected(stream)
        elif sys.stdin.isatty() and os.name == "nt":
            expected = read_expected_hidden()
        else:
            expected = read_expected(sys.stdin.buffer)
        session_path = find_single_session() if args.auto_session else args.session
        return verify(session_path, expected)
    except g3_state.StateError as error:
        return public_failure(error.code)
    except (ValueError, SystemExit):
        return public_failure("ACCOUNT_INPUT_INVALID")


if __name__ == "__main__":
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    print(json.dumps(main(), separators=(",", ":")), flush=True)
