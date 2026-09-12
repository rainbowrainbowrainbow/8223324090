"""Opt-in Windows SID bootstrap for the existing marker-only G3 observer.

Use an existing --session or the only canonical --auto-session. The default zero-second run takes one snapshot;
--seconds is bounded to 0..45. Local ACK affects only the synthetic-event journal.
No RAM scan, session creation, Viber UI/send, or CRM integration is introduced.
"""

import argparse
import importlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


BOOTSTRAP = "windows_sid"
MAX_OUTPUT = 8192


def local_module(name):
    """Resolve only reviewed neighboring modules, including in a Python -I child."""
    if name not in {"g3_state", "observe_g3", "recover_sid_key"}:
        raise ValueError("LOCAL_MODULE_REJECTED")
    script = Path(__file__).absolute()
    for path in (script, *script.parents):
        info = path.lstat()
        if info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError("LOCAL_MODULE_REJECTED")
    if script.resolve(strict=True) != script or not script.is_file():
        raise ValueError("LOCAL_MODULE_REJECTED")
    target = script.with_name(name + ".py")
    info = target.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
            or target.resolve(strict=True) != target):
        raise ValueError("LOCAL_MODULE_REJECTED")
    directory = str(script.parent)
    if not sys.path or sys.path[0] != directory:
        sys.path.insert(0, directory)
    module = importlib.import_module(name)
    if Path(module.__file__).resolve(strict=True) != target:
        raise ValueError("LOCAL_MODULE_REJECTED")
    return module


def sid_candidate():
    recovery = local_module("recover_sid_key")
    recovery.account_path()  # Strict no-reparse/sidecar gate; worker still owns source selection.
    return recovery.derive(recovery.static_prefix(), recovery.current_sid())


def find_single_session():
    """Resolve exactly one canonical private session without exporting its path."""
    state = local_module("g3_state")
    try:
        base = state._base_directory()
        candidates = [item for item in base.iterdir()
                      if item.is_dir() and state.DIRECTORY_PATTERN.fullmatch(item.name)]
        if len(candidates) != 1:
            raise state.StateError("STATE_PATH_REJECTED")
        return str(state._existing_directory(candidates[0]))
    except state.StateError:
        raise
    except Exception:
        raise state.StateError("STATE_PATH_REJECTED") from None


def valid_envelope(observer, value):
    return (type(value) is dict and value.keys() == {"bootstrap", "result"}
            and value["bootstrap"] == BOOTSTRAP and observer.valid_public(value["result"]))


def envelope(observer, result):
    value = {"bootstrap": BOOTSTRAP, "result": result}
    if not valid_envelope(observer, value):
        raise observer.ObserverError("PUBLIC_OUTPUT_REJECTED")
    return value


def failure(observer, code):
    report = observer.public_result()
    report["status"] = "FAILED"
    report["error_code"] = code if code in observer.ERRORS else "WORKER_FAILED"
    return envelope(observer, report)


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("DUPLICATE_OUTPUT_KEY")
        value[key] = item
    return value


def supervise(observer, session, seconds, local_ack, runner=None):
    if (type(seconds) is not int or not 0 <= seconds <= 45 or type(local_ack) is not bool
            or type(session) is not str or not session or len(session) > 1024):
        return failure(observer, "STATE_ARGUMENTS")
    command = [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--worker",
               "--session", session, "--seconds", str(seconds)]
    if local_ack:
        command.append("--local-ack-test")
    try:
        # subprocess.run kills and reaps only its own child on timeout.
        child = (runner or subprocess.run)(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            close_fds=True, timeout=45 + seconds,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if child.returncode != 0 or type(child.stdout) is not bytes or not 0 < len(child.stdout) <= MAX_OUTPUT:
            raise observer.ObserverError("PUBLIC_OUTPUT_REJECTED")
        try:
            value = json.loads(child.stdout, object_pairs_hook=unique_object)
            valid = valid_envelope(observer, value)
        except Exception:
            valid = False
        if not valid:
            raise observer.ObserverError("PUBLIC_OUTPUT_REJECTED")
        return value
    except BaseException as error:
        code = "WORKER_TIMEOUT" if isinstance(error, subprocess.TimeoutExpired) else getattr(error, "code", "WORKER_FAILED")
        return failure(observer, code)


class QuietParser(argparse.ArgumentParser):
    def error(self, _message):
        raise ValueError("STATE_ARGUMENTS")


def main(argv=None, observer=None):
    observer = observer or local_module("observe_g3")
    try:
        parser = QuietParser(add_help=False)
        sessions = parser.add_mutually_exclusive_group(required=True)
        sessions.add_argument("--session")
        sessions.add_argument("--auto-session", action="store_true")
        parser.add_argument("--seconds", type=int, default=0)
        parser.add_argument("--local-ack-test", action="store_true")
        parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
        args = parser.parse_args(argv)
        if (not 0 <= args.seconds <= 45
                or (args.session is not None and (not args.session or len(args.session) > 1024
                                                  or any(ord(char) < 32 for char in args.session)))
                or (args.worker and args.auto_session)):
            raise ValueError("STATE_ARGUMENTS")
    except (ValueError, argparse.ArgumentError, SystemExit):
        return failure(observer, "STATE_ARGUMENTS")
    try:
        if args.worker:
            return envelope(observer, observer.worker(
                args.session, args.seconds, args.local_ack_test, candidate_provider=sid_candidate))
        session = find_single_session() if args.auto_session else args.session
        return supervise(observer, session, args.seconds, args.local_ack_test)
    except BaseException as error:
        return failure(observer, getattr(error, "code", "WORKER_FAILED"))


if __name__ == "__main__":
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    try:
        print(json.dumps(main(), separators=(",", ":")), flush=True)
    except BaseException:
        # If the guarded local observer cannot load, emit no unvalidated output.
        raise SystemExit(2) from None
