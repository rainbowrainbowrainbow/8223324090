"""One build-pinned, owner-authorized READONLY schema recovery experiment.

Reconstruct the statically traced primary hexkey candidate from current Windows
user SID and a fixed public PE literal, exclusively in RAM. No Viber memory read,
CNG/DPAPI key export, arbitrary SQL, account writes, key output or persistence.
Run in an externally timed fresh child; never pass SID/key/account paths as args.
"""

import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import re
import stat

from trace_key_origin import Image, read_installed, EXPECTED_SHA
import probe_key_presence as probe
import g3_process
import probe_db_schema as schema
import qt_readonly_fixture as fixture


PREFIX_RVA = 0x5f57e98


def derive(prefix, sid):
    if (type(prefix) is not bytes or not 1 <= len(prefix) <= 128
            or any(not 32 <= value <= 126 for value in prefix)
            or type(sid) is not bytes or len(sid) > 184
            or not re.fullmatch(rb"S-1-5(?:-[0-9]{1,10}){2,16}", sid)):
        raise ValueError("DERIVATION_INPUT_REJECTED")
    # The traced input is ASCII. setw(2), fill('0'), hex/uppercase therefore
    # gives exactly two characters per byte; case is irrelevant to hexkey.
    return (prefix + sid[::-1]).hex().upper().encode("ascii")


def static_prefix():
    image = Image(read_installed())
    data = image.part(image.rva(PREFIX_RVA, 129), 129)
    end = data.find(b"\0")
    if end != 7 or not all(32 <= value <= 126 for value in data[:end]):
        raise ValueError("STATIC_PREFIX_REJECTED")
    return data[:end]


def current_sid():
    """Same GetUserNameW/LookupAccountNameW path, verified against own token.

    Windows allocates the SID string; its pointer is freed with LocalFree.
    No username, SID, domain or raw native error escapes this helper.
    """
    kernel, advapi = probe.windows_api()
    for function, result, args in (
        (advapi.GetUserNameW, w.BOOL, [w.LPWSTR, c.POINTER(w.DWORD)]),
        (advapi.LookupAccountNameW, w.BOOL, [w.LPCWSTR, w.LPCWSTR, c.c_void_p,
            c.POINTER(w.DWORD), w.LPWSTR, c.POINTER(w.DWORD), c.POINTER(w.DWORD)]),
        (advapi.IsValidSid, w.BOOL, [c.c_void_p]),
        (advapi.ConvertSidToStringSidW, w.BOOL, [c.c_void_p, c.POINTER(c.c_void_p)]),
        (kernel.LocalFree, c.c_void_p, [c.c_void_p]),
    ):
        function.restype, function.argtypes = result, args
    username = c.create_unicode_buffer(257)
    length = w.DWORD(len(username))
    if not advapi.GetUserNameW(username, c.byref(length)) or not 1 < length.value <= len(username):
        raise ValueError("USER_LOOKUP_FAILED")
    sid_size, domain_size, sid_type = w.DWORD(), w.DWORD(), w.DWORD()
    c.set_last_error(0)
    ok = advapi.LookupAccountNameW(None, username.value, None, c.byref(sid_size), None,
                                 c.byref(domain_size), c.byref(sid_type))
    if ok or c.get_last_error() != 122 or not 8 <= sid_size.value <= 1024 or not 1 <= domain_size.value <= 1024:
        raise ValueError("SID_LOOKUP_BOUND")
    sid = c.create_string_buffer(sid_size.value)
    domain = c.create_unicode_buffer(domain_size.value)
    if not advapi.LookupAccountNameW(None, username.value, sid, c.byref(sid_size), domain,
                                    c.byref(domain_size), c.byref(sid_type)):
        raise ValueError("SID_LOOKUP_FAILED")
    if sid_type.value != 1 or not advapi.IsValidSid(sid):
        raise ValueError("SID_NOT_USER")
    token, text = w.HANDLE(), c.c_void_p()
    try:
        if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 8, c.byref(token)):
            raise ValueError("TOKEN_QUERY_FAILED")
        needed = w.DWORD()
        advapi.GetTokenInformation(token, 1, None, 0, c.byref(needed))
        if not c.sizeof(c.c_void_p) <= needed.value <= 65536:
            raise ValueError("TOKEN_QUERY_BOUND")
        buffer = c.create_string_buffer(needed.value)
        if not advapi.GetTokenInformation(token, 1, buffer, needed, c.byref(needed)):
            raise ValueError("TOKEN_QUERY_FAILED")
        if not advapi.EqualSid(c.c_void_p.from_buffer(buffer), sid):
            raise ValueError("USER_TOKEN_MISMATCH")
        if not advapi.ConvertSidToStringSidW(sid, c.byref(text)) or not text.value:
            raise ValueError("SID_CONVERSION_FAILED")
        # IsValidSid constrains subauthority count; Microsoft allocates a
        # null-terminated SID string. Validate the returned text before use.
        value = c.wstring_at(text.value).encode("ascii")
        if len(value) > 184:
            raise ValueError("SID_TEXT_BOUND")
        return value
    finally:
        if text.value:
            kernel.LocalFree(text)
        if token:
            kernel.CloseHandle(token)


def account_path():
    root = Path(os.environ["APPDATA"]) / "ViberPC"
    found = list(root.glob("*/viber.db"))
    if len(found) != 1:
        raise ValueError("DATABASE_PATH_NOT_UNIQUE")
    path = found[0]
    for item in (path, *path.parents):
        if item.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError("DATABASE_PATH_REJECTED")
    if path.resolve(strict=True) != path.absolute() or not path.is_file():
        raise ValueError("DATABASE_PATH_REJECTED")
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(path) + suffix)
        if sidecar.exists() and sidecar.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError("SIDECAR_PATH_REJECTED")
    if Path(str(path) + "-wal").exists() and not Path(str(path) + "-shm").exists():
        raise ValueError("DATABASE_SIDECAR_UNAVAILABLE")
    return path


def self_test():
    # Synthetic identity only. This checks the traced reverse/hex contract,
    # not the value of an installed/account key.
    if derive(b"TEST", b"S-1-5-21-42") != b"5445535432342D31322D352D312D53":
        raise ValueError("SYNTHETIC_DERIVATION_FAILED")
    for prefix, sid in ((b"", b"S-1-5-21-42"), (b"\xff", b"S-1-5-21-42"),
                        (b"TEST", b"user"), (b"TEST", b"S-1-5-21-42\x00")):
        try:
            derive(prefix, sid)
        except ValueError:
            continue
        raise ValueError("SYNTHETIC_REJECTION_FAILED")
    return 5


def run(bindings):
    result = {"status": "NOT_RUN", "binary_sha256": EXPECTED_SHA,
              "derivation_self_checks": self_test(), "target_verified": False,
              "current_user_sid_verified": False, "synthetic_readonly_fixture_passed": False,
              "baseline_schema_readable": False, "baseline_sqlite_error": 0,
              "candidate_schema_readable": False, "candidate_sqlite_error": 0,
              "expected_schema_present": False, "database_file_identity_unchanged": False,
              "source_process_continuity": False, "candidate_count": 0,
              "message_or_contact_rows_queried": False, "process_memory_read": False,
              "cng_key_exported": False, "sid_or_key_persisted": False, "messages_sent": 0}
    guard = None
    candidate = None
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    try:
        prefix = static_prefix()
        guard = g3_process.capture(probe)
        result["target_verified"] = True
        candidate = derive(prefix, current_sid())
        prefix = None
        result["current_user_sid_verified"], result["candidate_count"] = True, 1
        context = fixture.initialize_qt(bindings)
        proof = fixture.run_fixture(context)
        if proof.get("status") != "PASS" or not proof.get("codec_see_compile_option"):
            raise ValueError("FIXTURE_FAILED")
        result["synthetic_readonly_fixture_passed"] = True
        path = account_path()
        initial = path.stat()
        identity = initial.st_dev, initial.st_ino
        if not guard.alive():
            raise ValueError("TARGET_CHANGED")
        _, readable, _, error = schema.check_one(context, path, None, 0)
        result["baseline_schema_readable"], result["baseline_sqlite_error"] = readable, error
        if readable:
            result["status"] = "BASELINE_ALREADY_READABLE"
            return result
        if error != 26:
            result["status"] = "BASELINE_NOT_KEY_FAILURE"
            return result
        current = path.stat()
        if not guard.alive() or account_path() != path or identity != (current.st_dev, current.st_ino):
            raise ValueError("SOURCE_CHANGED_BEFORE_CANDIDATE")
        _, readable, columns, error = schema.check_one(context, path, candidate, 1)
        candidate = None
        result["candidate_schema_readable"], result["candidate_sqlite_error"] = readable, error
        result["expected_schema_present"] = bool(columns and all(all(v.values()) for v in columns.values()))
        after = path.stat()
        result["database_file_identity_unchanged"] = identity == (after.st_dev, after.st_ino)
        result["source_process_continuity"] = guard.alive()
        passed = all(result[k] for k in ("candidate_schema_readable", "expected_schema_present",
                                         "database_file_identity_unchanged", "source_process_continuity"))
        result["status"] = "SID_RECOVERY_SCHEMA_PASS" if passed else "SID_RECOVERY_NOT_VALIDATED"
        return result
    except Exception:
        result["status"] = "SID_RECOVERY_FAILED"
        return result
    finally:
        candidate = None  # Reference release, not a secure memory-erasure claim.
        if guard is not None:
            guard.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bindings")
    parser.add_argument("--self-test", action="store_true")
    options = parser.parse_args()
    try:
        if options.self_test:
            result = {"status": "SYNTHETIC_PASS", "checks": self_test()}
        elif options.bindings:
            result = run(options.bindings)
        else:
            raise ValueError("ARGUMENTS_REQUIRED")
        print(json.dumps(result, separators=(",", ":")))
    except Exception:
        print('{"status":"SID_RECOVERY_FAILED"}')
        raise SystemExit(2) from None
