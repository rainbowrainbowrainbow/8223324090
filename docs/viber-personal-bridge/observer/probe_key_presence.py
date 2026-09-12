"""Bounded Windows Viber RAM probe; reports presence only, never key material.

No database access, DLL injection, process writes, dumps or sending.
Windows signature verification may perform certificate URL retrieval.
Run with Python 3.13: --self-test first, then no arguments for a live probe.
The internal worker verifies the installed executable and the same live handle.
"""

import ctypes
from ctypes import wintypes as wt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


CHUNK = 64 * 1024
OVERLAP = 2304
MAX_BYTES = 512 * 1024 * 1024
MAX_SECONDS = 15
MAX_REGIONS = 100000
ASCII_KEY = re.compile(
    rb"(?<![a-z_])PRAGMA[ \t]{1,8}hexkey[ \t]{0,8}=[ \t]{0,8}'(?:[0-9a-f]{2}){1,512}'",
    re.IGNORECASE,
)
UTF16_KEY = re.compile(
    rb"(?<![a-z_]\x00)P\x00R\x00A\x00G\x00M\x00A\x00(?:[ \t]\x00){1,8}"
    rb"h\x00e\x00x\x00k\x00e\x00y\x00(?:[ \t]\x00){0,8}"
    rb"=\x00(?:[ \t]\x00){0,8}'\x00(?:(?:[0-9a-f]\x00){2}){1,512}'\x00",
    re.IGNORECASE,
)


def contains_candidate(data):
    # SEE accepts variable-length hex, including encoded algorithm prefixes.
    # 2..1024 even hex characters is a scan bound, not a claimed Viber key length.
    # No decoding of unrelated memory, and no key escapes this predicate.
    return ASCII_KEY.search(data) is not None or UTF16_KEY.search(data) is not None


class SignatureWindow:
    def __init__(self):
        self.tail = bytearray()

    def reset(self):
        self.tail[:] = b"\0" * len(self.tail)
        self.tail.clear()

    def push(self, data):
        merged = bytearray(self.tail)
        merged.extend(data)
        folded = bytearray()
        try:
            # Most chunks contain no SQL prefix. A C-level byte search avoids
            # running both case-insensitive regex scans over those chunks.
            # Preserve the original merged buffer for the schema probe's
            # contains_candidate hook; only this gate uses the folded copy.
            folded = merged.lower()
            possible = b"pragma" in folded or b"p\0r\0a\0g\0m\0a\0" in folded
            found = contains_candidate(merged) if possible else False
            self.reset()
            self.tail = merged[-OVERLAP:]
            return found
        finally:
            folded[:] = b"\0" * len(folded)
            merged[:] = b"\0" * len(merged)


def public_result(status):
    return {
        "report_version": 1,
        "status": status,
        "target_verified": False,
        "target_check": "not_run",
        "process_memory_read": False,
        "private_region_scan_complete": False,
        "candidate_found": False,
        "bytes_read": 0,
        "regions_visited": 0,
        "read_failures": 0,
        "scan_elapsed_ms": 0,
        "database_open_attempted": False,
        "key_validated": False,
        "messages_sent": 0,
    }


def validate_result(value):
    template = public_result("probe_failed")
    statuses = {
        "probe_failed", "target_unavailable", "target_rejected", "access_denied",
        "candidate_present", "candidate_not_found", "scan_limited", "read_gaps",
        "target_exited", "query_failed", "probe_timeout", "unsupported_platform",
    }
    if not isinstance(value, dict) or value.keys() != template.keys():
        return False
    if value["status"] not in statuses:
        return False
    if value["target_check"] not in {"not_run", "enumerate", "path", "signature", "timestamp", "verified", "unavailable"}:
        return False
    for key, expected in template.items():
        if type(value[key]) is not type(expected):
            return False
        if type(expected) is int and not 0 <= value[key] <= MAX_BYTES:
            return False
    if value["status"] == "candidate_present" and not all(value[k] for k in ["candidate_found", "target_verified", "process_memory_read"]):
        return False
    if value["private_region_scan_complete"] and (not value["target_verified"] or value["read_failures"]):
        return False
    return (value["report_version"] == 1 and value["messages_sent"] == 0
            and value["database_open_attempted"] is False
            and value["key_validated"] is False)


def self_test():
    global contains_candidate
    checks = 0
    synthetic_key = "a1" * 32
    for statement in ["PRAGMA hexkey='" + synthetic_key + "'",
                      "pragma\tHEXKEY = '" + synthetic_key.upper() + "'"]:
        for encoding in ["ascii", "utf-16le"]:
            payload = statement.encode(encoding)
            assert contains_candidate(payload)
            checks += 1
            # Every split must be detected across an artificial chunk boundary.
            for split in range(1, len(payload)):
                tail = payload[:split][-OVERLAP:]
                assert contains_candidate(tail + payload[split:])
                checks += 1
                # Exercise the fast gate too, including a split inside PRAGMA
                # or in the middle of a UTF-16 code unit.
                stream = SignatureWindow()
                assert not stream.push(payload[:split])
                assert stream.push(payload[split:])
                stream.reset()
                checks += 2
    for payload in [b"", b"private chat text", b"PRAGMA hexkey='invalid'",
                    ("PRAGMA hexkey='" + "a" * 63 + "'").encode(),
                    ("PRAGMA hexkey='" + "a" * 65 + "'").encode(),
                    ("PRAGMA hexkey='" + synthetic_key).encode()]:
        assert not contains_candidate(payload)
        checks += 1
    for length in [2, 16, 32, 64, 78, 128, 512, 526, 1024]:
        for encoding in ["ascii", "utf-16le"]:
            payload = ("PRAGMA hexkey='" + "a" * length + "'").encode(encoding)
            stream = SignatureWindow()
            cut = len(payload) // 2
            assert not stream.push(payload[:cut])
            assert stream.push(payload[cut:])
            stream.reset()
            checks += 2
    for length in [1, 1023, 1025, 1026]:
        assert not contains_candidate(("PRAGMA hexkey='" + "a" * length + "'").encode())
        checks += 1
    # Actual stream state: adjacent regions retain overlap; gaps break it.
    for encoding in ["ascii", "utf-16le"]:
        payload = ("PRAGMA hexkey='" + synthetic_key + "'").encode(encoding)
        cut = len(payload) // 2
        stream = SignatureWindow()
        assert not stream.push(payload[:cut])
        assert stream.push(payload[cut:])
        stream.reset()
        assert not stream.push(payload[:cut])
        stream.reset()
        assert not stream.push(payload[cut:])
        stream.reset()
        checks += 4
    # Maximum-length signatures plus whitespace remain inside retained overlap.
    for encoding in ["ascii", "utf-16le"]:
        payload = ("PrAgMa        HeXkEy        =        '" + "A1" * 512 + "'").encode(encoding)
        for split in [1, 5, 11, len(payload) // 2, len(payload) - 1]:
            stream = SignatureWindow()
            assert not stream.push(b"\0" * CHUNK + payload[:split])
            assert stream.push(payload[split:])
            stream.reset()
            checks += 2
    # The collector monkeypatch must receive original case-preserved bytes.
    # Hold references to synthetic buffers to verify push wipes them afterwards.
    original_predicate = contains_candidate
    captured = []

    def synthetic_hook(data):
        captured.append(data)
        assert isinstance(data, bytearray)
        assert b"PrAgMa" in data or b"P\0r\0A\0g\0M\0a\0" in data
        return original_predicate(data)

    stream = SignatureWindow()
    try:
        contains_candidate = synthetic_hook
        assert not stream.push(b"\0" * CHUNK)
        assert not captured
        checks += 2
        for encoding in ["ascii", "utf-16le"]:
            payload = ("PrAgMa hexkey='" + synthetic_key + "'").encode(encoding)
            stream.reset()
            assert stream.push(b"\0" + payload)
            assert len(captured) == (1 if encoding == "ascii" else 2)
            assert not any(captured[-1])
            checks += 3
    finally:
        contains_candidate = original_predicate
        stream.reset()
        captured.clear()
    good = public_result("candidate_present")
    good["candidate_found"] = True
    good["target_verified"] = True
    good["process_memory_read"] = True
    assert validate_result(good)
    bad = dict(good, key=synthetic_key)
    assert not validate_result(bad)
    assert not validate_result(dict(good, status=synthetic_key))
    assert not validate_result(dict(good, bytes_read=True))
    assert not validate_result(dict(good, database_open_attempted=True))
    assert not validate_result(dict(good, target_verified=False))
    assert not validate_result(dict(good, private_region_scan_complete=True, read_failures=1))
    assert synthetic_key not in json.dumps(good)
    checks += 8
    return {"status": "passed", "checks": checks, "touches_viber": False}


def signed_target():
    # Fixed code, no private input interpolation, no arbitrary executable path.
    command = r"""
$ErrorActionPreference = 'Stop'
$stage = 'enumerate'
try {
    $items = @(Get-Process -Name Viber -ErrorAction SilentlyContinue)
    if ($items.Count -ne 1) { throw 'target' }
    $target = $items[0]
    $stage = 'path'
    $expected = Join-Path $env:LOCALAPPDATA 'Viber\Viber.exe'
    if ($target.Path -ne $expected) { throw 'target' }
    $stage = 'signature'
    $signature = Get-AuthenticodeSignature -LiteralPath $expected
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Viber Media') {
        throw 'target'
    }
    $stage = 'timestamp'
    @{ id=$target.Id; created=$target.StartTime.ToFileTimeUtc() } | ConvertTo-Json -Compress
} catch { @{ failure=$stage } | ConvertTo-Json -Compress }
"""
    executable = Path(os.environ["WINDIR"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    bundled = Path(os.environ["USERPROFILE"]) / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe"
    if bundled.is_file():
        executable = bundled
    environment = dict(os.environ)
    # Use only built-in modules belonging to the selected installed host.
    # This changes only the short-lived verifier environment, not Windows settings.
    environment["PSModulePath"] = str(executable.parent / "Modules")
    proc = subprocess.run(
        [str(executable), "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True, timeout=12, creationflags=subprocess.CREATE_NO_WINDOW,
        close_fds=True, check=False, env=environment,
    )
    if proc.returncode != 0 or len(proc.stdout) > 512:
        return None
    value = json.loads(proc.stdout)
    if set(value) == {"failure"} and value["failure"] in {"enumerate", "path", "signature", "timestamp"}:
        return value
    if set(value) != {"id", "created"} or any(type(v) is not int or v <= 0 for v in value.values()):
        return None
    return value


class MemoryInfo(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wt.DWORD), ("PartitionId", wt.WORD),
        ("RegionSize", ctypes.c_size_t), ("State", wt.DWORD),
        ("Protect", wt.DWORD), ("Type", wt.DWORD),
    ]


def windows_api():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    signatures = [
        (kernel.OpenProcess, [wt.DWORD, wt.BOOL, wt.DWORD], wt.HANDLE),
        (kernel.CloseHandle, [wt.HANDLE], wt.BOOL),
        (kernel.GetCurrentProcess, [], wt.HANDLE),
        (kernel.QueryFullProcessImageNameW, [wt.HANDLE, wt.DWORD, wt.LPWSTR, ctypes.POINTER(wt.DWORD)], wt.BOOL),
        (kernel.GetProcessTimes, [wt.HANDLE] + [ctypes.POINTER(wt.FILETIME)] * 4, wt.BOOL),
        (kernel.GetExitCodeProcess, [wt.HANDLE, ctypes.POINTER(wt.DWORD)], wt.BOOL),
        (kernel.VirtualQueryEx, [wt.HANDLE, ctypes.c_void_p, ctypes.POINTER(MemoryInfo), ctypes.c_size_t], ctypes.c_size_t),
        (kernel.ReadProcessMemory, [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)], wt.BOOL),
        (advapi.OpenProcessToken, [wt.HANDLE, wt.DWORD, ctypes.POINTER(wt.HANDLE)], wt.BOOL),
        (advapi.GetTokenInformation, [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD)], wt.BOOL),
        (advapi.EqualSid, [ctypes.c_void_p, ctypes.c_void_p], wt.BOOL),
    ]
    for function, args, result in signatures:
        function.argtypes, function.restype = args, result
    return kernel, advapi


def same_owner(kernel, advapi, handle):
    tokens, buffers = [], []
    try:
        for process in [kernel.GetCurrentProcess(), handle]:
            token = wt.HANDLE()
            if not advapi.OpenProcessToken(process, 0x0008, ctypes.byref(token)):
                return False
            tokens.append(token)
            needed = wt.DWORD()
            advapi.GetTokenInformation(token, 1, None, 0, ctypes.byref(needed))
            if not 0 < needed.value < 65536:
                return False
            buffer = ctypes.create_string_buffer(needed.value)
            if not advapi.GetTokenInformation(token, 1, buffer, needed, ctypes.byref(needed)):
                return False
            buffers.append(buffer)
        return bool(advapi.EqualSid(ctypes.c_void_p.from_buffer(buffers[0]), ctypes.c_void_p.from_buffer(buffers[1])))
    finally:
        for token in tokens:
            kernel.CloseHandle(token)


def worker():
    result = public_result("unsupported_platform")
    if os.name != "nt" or ctypes.sizeof(ctypes.c_void_p) != 8:
        return result
    target = signed_target()
    if target is None or "failure" in target:
        result["status"] = "target_unavailable"
        result["target_check"] = "unavailable" if target is None else target["failure"]
        return result
    kernel, advapi = windows_api()
    handle = kernel.OpenProcess(0x0010 | 0x0400, False, target["id"])
    if not handle:
        result["status"] = "access_denied"
        return result
    raw = bytearray(CHUNK)
    stream = SignatureWindow()
    try:
        result["status"] = "target_rejected"
        path = ctypes.create_unicode_buffer(32768)
        path_length = wt.DWORD(len(path))
        times = [wt.FILETIME() for _ in range(4)]
        if not kernel.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(path_length)):
            return result
        expected = str(Path(os.environ["LOCALAPPDATA"]) / "Viber/Viber.exe")
        if os.path.normcase(path.value) != os.path.normcase(expected):
            return result
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            return result
        created = times[0].dwLowDateTime | (times[0].dwHighDateTime << 32)
        if created != target["created"] or not same_owner(kernel, advapi, handle):
            return result
        result["target_verified"] = True
        result["target_check"] = "verified"
        start = time.monotonic()
        address = 0
        result["status"] = "scan_limited"
        view = (ctypes.c_ubyte * CHUNK).from_buffer(raw)
        while result["regions_visited"] < MAX_REGIONS:
            if time.monotonic() - start >= MAX_SECONDS or result["bytes_read"] >= MAX_BYTES:
                break
            info = MemoryInfo()
            size = kernel.VirtualQueryEx(handle, address, ctypes.byref(info), ctypes.sizeof(info))
            if size != ctypes.sizeof(info):
                if size == 0 and ctypes.get_last_error() == 87:
                    result["private_region_scan_complete"] = result["read_failures"] == 0
                    result["status"] = "read_gaps" if result["read_failures"] else "candidate_not_found"
                else:
                    result["status"] = "query_failed"
                break
            result["regions_visited"] += 1
            base = info.BaseAddress or 0
            end = base + info.RegionSize
            if end <= address:
                result["status"] = "query_failed"
                break
            # No image/mapped/execute/guard/noaccess pages; only private data.
            eligible = info.State == 0x1000 and info.Type == 0x20000 and info.Protect in (0x02, 0x04, 0x08)
            if eligible:
                position = base
                while position < end and result["bytes_read"] < MAX_BYTES:
                    if time.monotonic() - start >= MAX_SECONDS:
                        break
                    length = min(CHUNK, end - position, MAX_BYTES - result["bytes_read"])
                    read = ctypes.c_size_t()
                    ok = kernel.ReadProcessMemory(handle, position, view, length, ctypes.byref(read))
                    result["process_memory_read"] |= read.value > 0
                    result["bytes_read"] += read.value
                    if not ok or read.value != length:
                        result["read_failures"] += 1
                        stream.reset()
                    else:
                        found = stream.push(memoryview(raw)[:length])
                        if found:
                            result["candidate_found"] = True
                            result["status"] = "candidate_present"
                            break
                    raw[:] = b"\0" * CHUNK
                    position += length
                if result["candidate_found"]:
                    break
            else:
                # Retain overlap across adjacent readable private regions only.
                stream.reset()
            address = end
        result["scan_elapsed_ms"] = int((time.monotonic() - start) * 1000)
        code = wt.DWORD()
        if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:
            result["status"] = "target_exited"
            result["private_region_scan_complete"] = False
        return result
    finally:
        raw[:] = b"\0" * len(raw)
        stream.reset()
        kernel.CloseHandle(handle)


def main():
    try:
        if sys.argv[1:] == ["--self-test"]:
            return self_test()
        if sys.argv[1:] == ["--worker"]:
            return worker()
        if sys.argv[1:]:
            return public_result("probe_failed")
        # Only this helper is terminated on deadline; stderr is never forwarded.
        proc = subprocess.run(
            [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--worker"],
            capture_output=True, timeout=40, close_fds=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            check=False,
        )
        if proc.returncode != 0 or len(proc.stdout) > 4096:
            return public_result("probe_failed")
        value = json.loads(proc.stdout)
        return value if validate_result(value) else public_result("probe_failed")
    except subprocess.TimeoutExpired:
        return public_result("probe_timeout")
    except BaseException:
        # Never print exception messages, locals, SQL, paths, buffers or tracebacks.
        return public_result("probe_failed")


if __name__ == "__main__":
    print(json.dumps(main(), separators=(",", ":")))
