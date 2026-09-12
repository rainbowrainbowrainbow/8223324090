"""Private local G3 test state; no Viber access, credentials or message data.

Python 3.13+ on Windows is required for mkdir(0o700)'s Windows ACL handling.
The seed is test-only HMAC material protected with current-user DPAPI. Python
does not guarantee erasure of immutable plaintext copies or prevent OS paging.
Missing/corrupt state is never regenerated. Failed creation may leave an empty
directory or encrypted temporary file; no automatic deletion is performed.
"""
import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys


SCHEMA_VERSION = 1
CONFIG_NAME = "session.dpapi"
JOURNAL_CLAIM_NAME = "journal.claim"
JOURNAL_CLAIM_BYTES = b"EVENTGENIX_G3_JOURNAL_CLAIM_V1\n"
JOURNAL_APPLICATION_ID = 0x45475833
JOURNAL_SCHEMA_VERSION = 1
CODEX_PACKAGE_FAMILY = "OpenAI.Codex_2p2nqsd0c76g0"
MAX_CONFIG_BYTES = 16384
MAX_PAYLOAD_BYTES = 8192
MAX_PATH_CHARS = 1024
RUN_PATTERN = re.compile(r"[0-9A-F]{8}\Z")
DIRECTORY_PATTERN = re.compile(r"g3-([0-9A-F]{8})\Z")
PAYLOAD_KEYS = {"schema_version", "run_id", "hmac_key_base64", "bindings_path"}
ERROR_CODES = {
    "STATE_ARGUMENTS", "STATE_UNSUPPORTED_RUNTIME", "STATE_PATH_REJECTED",
    "STATE_MISSING", "STATE_READ_FAILED", "STATE_WRITE_FAILED",
    "STATE_CORRUPT", "STATE_VERSION_UNSUPPORTED", "STATE_DPAPI_FAILED",
    "STATE_COLLISION", "STATE_BINDINGS_UNAVAILABLE", "STATE_SELF_TEST_FAILED",
    "STATE_JOURNAL_MISSING", "STATE_JOURNAL_CORRUPT", "STATE_JOURNAL_UNCLAIMED",
    "STATE_JOURNAL_INCOMPLETE",
}


class StateError(Exception):
    """Public failures carry only a fixed, non-sensitive enum."""

    def __init__(self, code):
        self.code = code if code in ERROR_CODES else "STATE_CORRUPT"
        super().__init__(self.code)


def _require_runtime():
    if os.name != "nt" or sys.version_info < (3, 13):
        raise StateError("STATE_UNSUPPORTED_RUNTIME")


def _absolute_path(value):
    if not isinstance(value, (str, Path)):
        raise StateError("STATE_PATH_REJECTED")
    raw = str(value)
    if (not raw or len(raw) > MAX_PATH_CHARS
            or any(ord(char) < 32 for char in raw)):
        raise StateError("STATE_PATH_REJECTED")
    path = Path(raw)
    if (not path.is_absolute() or not re.fullmatch(r"[A-Za-z]:", path.drive)
            or ":" in raw[2:] or ".." in path.parts):
        raise StateError("STATE_PATH_REJECTED")
    for part in path.parts[1:]:
        if (part.endswith((" ", ".")) or any(char in part for char in '<>"|?*')
                or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part)):
            raise StateError("STATE_PATH_REJECTED")
    return path


def _same_path(left, right):
    return os.path.normcase(str(left)) == os.path.normcase(str(right))


def _directory_chain(path):
    """Reject every reparse point in the chain, including directory junctions."""
    for component in reversed((path, *path.parents)):
        info = component.lstat()
        if (not stat.S_ISDIR(info.st_mode)
                or info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT):
            raise StateError("STATE_PATH_REJECTED")


def _existing_directory(path):
    _directory_chain(path)
    resolved = path.resolve(strict=True)
    if not _same_path(path, resolved):
        raise StateError("STATE_PATH_REJECTED")
    return resolved


def _repository_root():
    script = Path(__file__).resolve()
    for candidate in (script.parent, *script.parents):
        if (candidate / "package.json").is_file() and (candidate / ".git").exists():
            return candidate
    return None


def _outside_sync_and_workspace(path):
    protected = []
    repository = _repository_root()
    if repository is not None:
        protected.append(repository)
    for name in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        value = os.environ.get(name)
        if value:
            protected.append(_absolute_path(value).resolve(strict=False))
    if any(path.is_relative_to(root) for root in protected):
        raise StateError("STATE_PATH_REJECTED")
    if any(part.casefold() == "onedrive" or part.casefold().startswith("onedrive - ")
           for part in path.parts):
        raise StateError("STATE_PATH_REJECTED")


def _allowed_application_parent(local, resolved):
    # Packaged Codex redirects this one LocalAppData path without a reparse
    # point. Do not accept arbitrary resolved paths or other package families.
    ordinary = local / "EventGenix"
    packaged = (local / "Packages" / CODEX_PACKAGE_FAMILY / "LocalCache"
                / "Local" / "EventGenix")
    if not any(_same_path(resolved, allowed) for allowed in (ordinary, packaged)):
        raise StateError("STATE_PATH_REJECTED")
    return resolved


def _base_directory(create=False):
    _require_runtime()
    local = _absolute_path(os.environ.get("LOCALAPPDATA", ""))
    _existing_directory(local)
    application = local / "EventGenix"
    _outside_sync_and_workspace(application)
    if create:
        try:
            application.mkdir(mode=0o700)
        except FileExistsError:
            pass
    _directory_chain(application)
    canonical = _allowed_application_parent(local, application.resolve(strict=True))
    _existing_directory(canonical)
    base = canonical / "ViberBridgeResearch"
    _outside_sync_and_workspace(base)
    if create:
        try:
            # Windows Python 3.13: current user and administrators only.
            base.mkdir(mode=0o700)
        except FileExistsError:
            pass
    _existing_directory(base)
    return base


def _bindings_directory(value):
    try:
        return _existing_directory(_absolute_path(value))
    except (OSError, ValueError, StateError):
        raise StateError("STATE_BINDINGS_UNAVAILABLE") from None


def _session_root(value):
    base = _base_directory()
    path = _absolute_path(value)
    if not DIRECTORY_PATTERN.fullmatch(path.name) or not _same_path(path.parent, base):
        raise StateError("STATE_PATH_REJECTED")
    return _existing_directory(path)


def _regular_file(path):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode)
            or info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
            or info.st_nlink != 1):
        raise StateError("STATE_PATH_REJECTED")
    return info


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _dpapi(data, protect):
    _require_runtime()
    limit = MAX_PAYLOAD_BYTES if protect else MAX_CONFIG_BYTES
    if type(data) is not bytes or not 0 < len(data) <= limit:
        raise StateError("STATE_CORRUPT")
    source = ctypes.create_string_buffer(data, len(data))
    incoming = _DataBlob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = _DataBlob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    # Flags exclude CRYPTPROTECT_LOCAL_MACHINE. No entropy, prompt or profile edits.
    flags = 0x1  # CRYPTPROTECT_UI_FORBIDDEN
    try:
        if protect:
            function = crypt32.CryptProtectData
            function.argtypes = [ctypes.POINTER(_DataBlob), wintypes.LPCWSTR,
                                 ctypes.POINTER(_DataBlob), ctypes.c_void_p,
                                 ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_DataBlob)]
            function.restype = wintypes.BOOL
            succeeded = function(ctypes.byref(incoming), "EventGenix G3 test state v1",
                                 None, None, None, flags, ctypes.byref(outgoing))
        else:
            function = crypt32.CryptUnprotectData
            function.argtypes = [ctypes.POINTER(_DataBlob), ctypes.c_void_p,
                                 ctypes.POINTER(_DataBlob), ctypes.c_void_p,
                                 ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_DataBlob)]
            function.restype = wintypes.BOOL
            succeeded = function(ctypes.byref(incoming), None, None, None, None,
                                 flags, ctypes.byref(outgoing))
        if not succeeded:
            raise StateError("STATE_DPAPI_FAILED")
        maximum = MAX_CONFIG_BYTES if protect else MAX_PAYLOAD_BYTES
        if not outgoing.pbData or not 0 < outgoing.cbData <= maximum:
            raise StateError("STATE_CORRUPT")
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        ctypes.memset(source, 0, len(data))
        if outgoing.pbData:
            ctypes.memset(outgoing.pbData, 0, outgoing.cbData)
            kernel32.LocalFree(ctypes.cast(outgoing.pbData, ctypes.c_void_p))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise StateError("STATE_CORRUPT")
        result[key] = value
    return result


def _decode_payload(raw, expected_run_id):
    try:
        if type(raw) is not bytes or not 0 < len(raw) <= MAX_PAYLOAD_BYTES:
            raise StateError("STATE_CORRUPT")
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
        if type(value) is not dict or value.keys() != PAYLOAD_KEYS:
            raise StateError("STATE_CORRUPT")
        if type(value["schema_version"]) is not int:
            raise StateError("STATE_CORRUPT")
        if value["schema_version"] != SCHEMA_VERSION:
            raise StateError("STATE_VERSION_UNSUPPORTED")
        if (type(value["run_id"]) is not str or not RUN_PATTERN.fullmatch(value["run_id"])
                or value["run_id"] != expected_run_id):
            raise StateError("STATE_CORRUPT")
        encoded = value["hmac_key_base64"]
        if type(encoded) is not str or len(encoded) != 44:
            raise StateError("STATE_CORRUPT")
        key = base64.b64decode(encoded, validate=True)
        if len(key) != 32 or base64.b64encode(key).decode("ascii") != encoded:
            raise StateError("STATE_CORRUPT")
        if type(value["bindings_path"]) is not str:
            raise StateError("STATE_CORRUPT")
        bindings = _absolute_path(value["bindings_path"])
        return {"run_id": value["run_id"], "hmac_key": key, "bindings_path": str(bindings)}
    except StateError:
        raise
    except Exception:
        raise StateError("STATE_CORRUPT") from None


def create_session(bindings_path):
    """Create a new private directory and encrypted config, never overwrite one."""
    try:
        _require_runtime()
        bindings = _bindings_directory(bindings_path)
        base = _base_directory(create=True)
        for _ in range(8):
            run_id = secrets.token_hex(4).upper()
            root = base / ("g3-" + run_id)
            try:
                root.mkdir(mode=0o700)
                break
            except FileExistsError:
                continue
        else:
            raise StateError("STATE_COLLISION")
        _existing_directory(root)
        payload = {"schema_version": SCHEMA_VERSION, "run_id": run_id,
                   "hmac_key_base64": base64.b64encode(secrets.token_bytes(32)).decode("ascii"),
                   "bindings_path": str(bindings)}
        raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        encrypted = _dpapi(raw, protect=True)
        temporary = root / "session.pending"
        final = root / CONFIG_NAME
        with temporary.open("xb") as output:
            output.write(encrypted)
            output.flush()
            os.fsync(output.fileno())
        _session_root(root)
        _regular_file(temporary)
        # On Windows rename fails when destination exists; never use replace().
        os.rename(temporary, final)
        _regular_file(final)
        return root
    except StateError:
        raise
    except Exception:
        raise StateError("STATE_WRITE_FAILED") from None


def load_session(path):
    """Load an existing session; missing state never produces a replacement seed."""
    try:
        root = _session_root(path)
        config = root / CONFIG_NAME
        before = _regular_file(config)
        if not 0 < before.st_size <= MAX_CONFIG_BYTES:
            raise StateError("STATE_CORRUPT")
        with config.open("rb") as source:
            opened = os.fstat(source.fileno())
            if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
                raise StateError("STATE_PATH_REJECTED")
            encrypted = source.read(MAX_CONFIG_BYTES + 1)
        after = _regular_file(config)
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)):
            raise StateError("STATE_READ_FAILED")
        _session_root(root)
        value = _decode_payload(_dpapi(encrypted, protect=False), root.name[3:])
        value["bindings_path"] = str(_bindings_directory(value["bindings_path"]))
        return value
    except StateError:
        raise
    except FileNotFoundError:
        raise StateError("STATE_MISSING") from None
    except Exception:
        raise StateError("STATE_READ_FAILED") from None


def journal_path(path):
    """Return the fixed journal path only for an intact, validated session."""
    try:
        load_session(path)
        root = _session_root(path)
        journal = root / "journal.sqlite"
        try:
            _regular_file(journal)
        except FileNotFoundError:
            pass
        return journal
    except StateError:
        raise
    except FileNotFoundError:
        raise StateError("STATE_MISSING") from None
    except Exception:
        raise StateError("STATE_PATH_REJECTED") from None


def _claim_decision(claim_bytes, journal_exists):
    """Pure state transition; None means the claim has never been created."""
    if claim_bytes is None:
        if journal_exists:
            raise StateError("STATE_JOURNAL_UNCLAIMED")
        return True
    if claim_bytes != JOURNAL_CLAIM_BYTES:
        raise StateError("STATE_JOURNAL_CORRUPT")
    if not journal_exists:
        raise StateError("STATE_JOURNAL_MISSING")
    return False


def _validate_journal_header(header):
    # These are public SQLite header fields, not SQL or journal payload reads.
    # The journal's own schema check remains necessary after this guard.
    if (type(header) is not bytes or len(header) != 100
            or header[:16] != b"SQLite format 3\0"
            or int.from_bytes(header[60:64], "big") != JOURNAL_SCHEMA_VERSION
            or int.from_bytes(header[68:72], "big") != JOURNAL_APPLICATION_ID):
        raise StateError("STATE_JOURNAL_CORRUPT")


def _read_guarded_prefix(path, length, *, exact_size=False):
    before = _regular_file(path)
    if before.st_size < length or (exact_size and before.st_size != length):
        raise StateError("STATE_JOURNAL_CORRUPT")
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise StateError("STATE_PATH_REJECTED")
        data = source.read(length)
    after = _regular_file(path)
    if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)):
        raise StateError("STATE_READ_FAILED")
    if len(data) != length:
        raise StateError("STATE_JOURNAL_CORRUPT")
    return data


def _claim_journal_files(root):
    """Internal file transition; public caller validates and locks the root."""
    journal = root / "journal.sqlite"
    claim = root / JOURNAL_CLAIM_NAME
    try:
        claim_bytes = _read_guarded_prefix(claim, len(JOURNAL_CLAIM_BYTES), exact_size=True)
    except FileNotFoundError:
        claim_bytes = None
    try:
        _regular_file(journal)
        journal_exists = True
    except FileNotFoundError:
        journal_exists = False
    first = _claim_decision(claim_bytes, journal_exists)
    if first:
        # A leftover sidecar is evidence of an earlier initialization.
        for suffix in ("-journal", "-wal", "-shm"):
            sidecar = journal.with_name(journal.name + suffix)
            try:
                sidecar.lstat()
            except FileNotFoundError:
                continue
            raise StateError("STATE_JOURNAL_UNCLAIMED")
        try:
            with claim.open("xb") as output:
                output.write(JOURNAL_CLAIM_BYTES)
                output.flush()
                os.fsync(output.fileno())
        except FileExistsError:
            raise StateError("STATE_JOURNAL_INCOMPLETE") from None
        _read_guarded_prefix(claim, len(JOURNAL_CLAIM_BYTES), exact_size=True)
    else:
        _validate_journal_header(_read_guarded_prefix(journal, 100))
    return journal, first


def claim_journal_initialization(path):
    """Return (journal_path, first_initialization) while holding session lock.

    Call immediately before constructing Journal. A durable exclusive claim is
    written before first creation. Subsequent calls require an existing journal
    with our nonempty SQLite header. The caller MUST also reject a reused
    journal whose snapshot baseline is None, before initialize_baseline; this
    handles a crash after schema creation but before initial baseline commit.
    Never remove the claim to repair failed state; use an explicit new session.
    """
    try:
        journal_path(path)
        root = _session_root(path)
        journal, first = _claim_journal_files(root)
        _session_root(root)
        return journal, first
    except StateError:
        raise
    except FileNotFoundError:
        raise StateError("STATE_JOURNAL_MISSING") from None
    except Exception:
        raise StateError("STATE_WRITE_FAILED") from None


def self_test():
    """Synthetic RAM-only DPAPI round trip and payload/path rejection checks."""
    _require_runtime()
    assertions = 0

    def check(condition):
        nonlocal assertions
        if not condition:
            raise StateError("STATE_SELF_TEST_FAILED")
        assertions += 1

    random_data = secrets.token_bytes(32)
    protected = _dpapi(random_data, protect=True)
    check(protected != random_data)
    check(_dpapi(protected, protect=False) == random_data)
    valid = {"schema_version": 1, "run_id": "ABCDEF12",
             "hmac_key_base64": base64.b64encode(random_data).decode("ascii"),
             "bindings_path": r"C:\Synthetic\bindings"}
    raw = json.dumps(valid).encode("utf-8")
    decoded = _decode_payload(raw, "ABCDEF12")
    check(decoded["hmac_key"] == random_data)
    check(decoded["run_id"] == "ABCDEF12")
    invalid_payloads = [b"{}", b"[]", b"not json", b"x" * (MAX_PAYLOAD_BYTES + 1)]
    for field, value in (("schema_version", True), ("schema_version", 2),
                         ("run_id", "abcdef12"), ("run_id", "12345678"),
                         ("hmac_key_base64", "A" * 44),
                         ("hmac_key_base64", base64.b64encode(b"x" * 31).decode("ascii")),
                         ("bindings_path", "relative"), ("bindings_path", 1),
                         ("unexpected", "synthetic")):
        invalid_payloads.append(json.dumps({**valid, field: value}).encode("utf-8"))
    invalid_payloads.append(raw[:-1] + b',"schema_version":1}')
    for value in invalid_payloads:
        try:
            _decode_payload(value, "ABCDEF12")
        except StateError as error:
            check(error.code in ERROR_CODES)
        else:
            check(False)
    for value in ("", "relative", r"C:relative", r"\\server\share", r"C:\x\..\y",
                  r"C:\x:stream", "C:\\x\x00y", r"C:\NUL", "C:\\x.\\y"):
        try:
            _absolute_path(value)
        except StateError:
            check(True)
        else:
            check(False)
    check(str(StateError("untrusted synthetic text")) == "STATE_CORRUPT")
    local = Path(r"C:\Synthetic\Local")
    ordinary = local / "EventGenix"
    packaged = (local / "Packages" / CODEX_PACKAGE_FAMILY / "LocalCache"
                / "Local" / "EventGenix")
    for allowed in (ordinary, packaged):
        check(_allowed_application_parent(local, allowed) == allowed)
    for rejected in (local / "Other", local / "Packages" / "OtherApp" / "LocalCache"
                     / "Local" / "EventGenix", Path(r"D:\EventGenix")):
        try:
            _allowed_application_parent(local, rejected)
        except StateError:
            check(True)
        else:
            check(False)
    check(_claim_decision(None, False) is True)
    check(_claim_decision(JOURNAL_CLAIM_BYTES, True) is False)
    for claim, exists, expected_code in (
            (None, True, "STATE_JOURNAL_UNCLAIMED"),
            (JOURNAL_CLAIM_BYTES, False, "STATE_JOURNAL_MISSING"),
            (b"", False, "STATE_JOURNAL_CORRUPT"),
            (b"bad", True, "STATE_JOURNAL_CORRUPT")):
        try:
            _claim_decision(claim, exists)
        except StateError as error:
            check(error.code == expected_code)
        else:
            check(False)
    header = bytearray(100)
    header[:16] = b"SQLite format 3\0"
    header[60:64] = JOURNAL_SCHEMA_VERSION.to_bytes(4, "big")
    header[68:72] = JOURNAL_APPLICATION_ID.to_bytes(4, "big")
    _validate_journal_header(bytes(header))
    check(True)
    wrong_version, wrong_application = bytearray(header), bytearray(header)
    wrong_version[60:64] = (0).to_bytes(4, "big")
    wrong_application[68:72] = (0).to_bytes(4, "big")
    for malformed in (b"", b"x" * 100, bytes(header[:99]), bytes(wrong_version),
                      bytes(wrong_application)):
        try:
            _validate_journal_header(malformed)
        except StateError as error:
            check(error.code == "STATE_JOURNAL_CORRUPT")
        else:
            check(False)
    return {"status": "SELF_TEST_PASSED", "assertions": assertions,
            "dpapi_synthetic_roundtrip": True, "filesystem_writes": False,
            "viber_accessed": False}


def filesystem_self_test():
    """Exercise only self-created synthetic files in a new nonsynced temp root."""
    import tempfile

    _require_runtime()
    parent = Path(tempfile.gettempdir()).resolve(strict=True)
    _existing_directory(parent)
    _outside_sync_and_workspace(parent)
    root = Path(tempfile.mkdtemp(prefix="eventgenix-g3-state-selftest-", dir=parent)).resolve(strict=True)
    if not _same_path(root.parent, parent) or not root.name.startswith("eventgenix-g3-state-selftest-"):
        raise StateError("STATE_PATH_REJECTED")
    _existing_directory(root)
    journal = root / "journal.sqlite"
    claim = root / JOURNAL_CLAIM_NAME
    sidecar = root / "journal.sqlite-wal"
    owned_files = (journal, claim, sidecar)
    assertions = 0

    def check(condition):
        nonlocal assertions
        if not condition:
            raise StateError("STATE_SELF_TEST_FAILED")
        assertions += 1

    def rejects(code):
        try:
            _claim_journal_files(root)
        except StateError as error:
            check(error.code == code)
        else:
            check(False)

    try:
        path, first = _claim_journal_files(root)
        check(path == journal and first is True)
        check(claim.read_bytes() == JOURNAL_CLAIM_BYTES)
        rejects("STATE_JOURNAL_MISSING")
        journal.write_bytes(b"")
        rejects("STATE_JOURNAL_CORRUPT")
        journal.write_bytes(b"x" * 100)
        rejects("STATE_JOURNAL_CORRUPT")
        header = bytearray(100)
        header[:16] = b"SQLite format 3\0"
        header[60:64] = JOURNAL_SCHEMA_VERSION.to_bytes(4, "big")
        header[68:72] = JOURNAL_APPLICATION_ID.to_bytes(4, "big")
        journal.write_bytes(header)
        path, first = _claim_journal_files(root)
        check(path == journal and first is False)
        claim.write_bytes(b"")
        rejects("STATE_JOURNAL_CORRUPT")
        claim.unlink()
        rejects("STATE_JOURNAL_UNCLAIMED")
        journal.unlink()
        sidecar.write_bytes(b"synthetic")
        rejects("STATE_JOURNAL_UNCLAIMED")
        return {"status": "FILESYSTEM_SELF_TEST_PASSED", "assertions": assertions,
                "synthetic_files_only": True, "viber_accessed": False}
    finally:
        # No recursive cleanup and no pre-existing paths. Revalidate before
        # deleting these exact files and the empty directory created above.
        _existing_directory(root)
        if not _same_path(root.parent, parent):
            raise StateError("STATE_PATH_REJECTED")
        for path in owned_files:
            try:
                _regular_file(path)
            except FileNotFoundError:
                continue
            path.unlink()
        root.rmdir()


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            result = self_test()
        elif sys.argv[1:] == ["--self-test-files"]:
            result = filesystem_self_test()
        else:
            raise StateError("STATE_ARGUMENTS")
        print(json.dumps(result))
    except StateError as failure:
        print(json.dumps({"status": failure.code}))
        raise SystemExit(2)
    except Exception:
        print(json.dumps({"status": "STATE_SELF_TEST_FAILED"}))
        raise SystemExit(2)
