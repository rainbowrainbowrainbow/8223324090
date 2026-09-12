"""Bounded offline DbgEng image disassembly; never attach or launch Viber.

Run --self-test first. --installed is reserved for the separately reviewed
static audit of the exact pinned distribution file, not process/account data.
The default entrypoints supervise their own child with a 40-second deadline.
Internal worker modes must also remain under an external deadline.

COM indices/GUIDs were counted from the official Microsoft header:
https://raw.githubusercontent.com/microsoft/win32metadata/71033001b4479c6566546b68d32276e70a8d68b9/generation/WinSDK/RecompiledIdlHeaders/um/DbgEng.h
SHA256 a9037bf9a096700082ec5d4d96a98d1d98dee6c8ed71b3eac8de64c1fd9a0f4f
That header defines IMAGE_FILE class 3 and qualifier 1027; the public
GetDebuggeeType documentation omits them. Runtime fixture proof is mandatory.
"""
import ctypes
from ctypes import wintypes as wt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import tempfile
import time
import uuid


HEADER_SHA256 = "a9037bf9a096700082ec5d4d96a98d1d98dee6c8ed71b3eac8de64c1fd9a0f4f"
HEADER_URL = "https://raw.githubusercontent.com/microsoft/win32metadata/71033001b4479c6566546b68d32276e70a8d68b9/generation/WinSDK/RecompiledIdlHeaders/um/DbgEng.h"
EXPECTED_VIBER_SHA256 = "7c6f4f7c463e631f43590a189ee40e3cad733759afd04d89fc80e25ae610f99b"
RANGES = (
    ("hexkey_open", 0x340290, 0x3408B1),
    ("open_caller_one", 0x32D550, 0x32D705),
    ("open_caller_two", 0x3409E0, 0x340CC6),
    ("dpapi_function_one", 0x82EE00, 0x82F577),
    ("dpapi_function_two", 0x82F580, 0x82FC39),
)
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_INSTRUCTIONS = 4096
MAX_OUTPUT_BYTES = 1024 * 1024
CHILD_TIMEOUT = 40
FIXTURE_PREFIX = "eventgenix-dbgeng-fixture-"
ERROR_CODES = {
    "ARGUMENTS_REJECTED", "PLATFORM_UNSUPPORTED", "PATH_REJECTED", "FILE_CHANGED",
    "BINARY_MISMATCH", "PE_REJECTED", "SYSTEM_DLL_REJECTED", "DEBUG_CREATE_FAILED",
    "INTERFACE_FAILED", "SAFETY_OPTIONS_FAILED", "OPEN_IMAGE_FAILED", "WAIT_FAILED",
    "IMAGE_CLASS_REQUIRED", "DISASSEMBLY_FAILED", "INSTRUCTION_LIMIT", "OUTPUT_REJECTED",
    "FIXTURE_FAILED", "WORKER_FAILED", "WORKER_TIMEOUT", "CLEANUP_FAILED",
}


class AuditError(Exception):
    def __init__(self, code):
        self.code = code if type(code) is str and code in ERROR_CODES else "WORKER_FAILED"
        super().__init__(self.code)


class GUID(ctypes.Structure):
    _fields_ = [("data1", wt.DWORD), ("data2", wt.WORD), ("data3", wt.WORD),
                ("data4", ctypes.c_ubyte * 8)]

    @classmethod
    def parse(cls, value):
        return cls.from_buffer_copy(uuid.UUID(value).bytes_le)


IID_CLIENT = GUID.parse("27fe5639-8407-4f47-8364-ee118fb08ac8")
IID_CONTROL = GUID.parse("5182e668-105e-416e-ad92-24ef800424ba")
IID_SYMBOLS = GUID.parse("8c31e98c-983a-48a5-9016-6fe5d667a950")
PVOID = ctypes.c_void_p
PULONG = ctypes.POINTER(wt.ULONG)
PULONG64 = ctypes.POINTER(ctypes.c_ulonglong)

# This method allowlist deliberately has no target creation, attachment,
# debugger-command execution, assembly, process writes or process control.
METHODS = {
    ("client", "OpenDumpFile"): (19, (ctypes.c_char_p,)),
    ("control", "Disassemble"): (26, (ctypes.c_ulonglong, wt.ULONG, PVOID,
                                          wt.ULONG, PULONG, PULONG64)),
    ("control", "GetDebuggeeType"): (34, (PULONG, PULONG)),
    ("control", "GetEngineOptions"): (53, (PULONG,)),
    ("control", "SetEngineOptions"): (56, (wt.ULONG,)),
    ("control", "WaitForEvent"): (93, (wt.ULONG, wt.ULONG)),
    ("symbols", "SetSymbolOptions"): (6, (wt.ULONG,)),
    ("symbols", "GetNumberModules"): (12, (PULONG, PULONG)),
    ("symbols", "GetModuleByIndex"): (13, (wt.ULONG, PULONG64)),
    ("symbols", "SetSymbolPath"): (41, (ctypes.c_char_p,)),
    ("symbols", "SetImagePath"): (44, (ctypes.c_char_p,)),
}
# IDebugControl includes three STDMETHODV methods (Output, ControlledOutput,
# OutputPrompt). They occupy vtable slots too; omitting them shifts every
# control index after slot 18. Root independently recounted the full sequence.
# DISALLOW_NETWORK_PATHS, DISALLOW_SHELL_COMMANDS, DISABLE_MANAGED_SUPPORT,
# DISABLE_MODULE_SYMBOL_LOAD, DISABLE_EXECUTION_COMMANDS, DISABLESQM.
ENGINE_OPTIONS = 0x00000008 | 0x00001000 | 0x00004000 | 0x00008000 | 0x00010000 | 0x00080000
# DEFERRED_LOADS, IGNORE_NT_SYMPATH, SECURE, NO_PROMPTS,
# DISABLE_SYMSRV_AUTODETECT. Module symbol loading is separately disabled.
SYMBOL_OPTIONS = 0x4 | 0x1000 | 0x40000 | 0x80000 | 0x02000000


def _platform():
    if os.name != "nt" or ctypes.sizeof(PVOID) != 8:
        raise AuditError("PLATFORM_UNSUPPORTED")


def _same_path(left, right):
    return os.path.normcase(str(left)) == os.path.normcase(str(right))


def _checked_path(path, directory=False, allow_system_hardlinks=False):
    path = Path(path)
    if (not path.is_absolute() or not re.fullmatch(r"[A-Za-z]:", path.drive)
            or ".." in path.parts or len(str(path)) > 1024):
        raise AuditError("PATH_REJECTED")
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise AuditError("PATH_REJECTED")
    info = path.stat()
    if (directory and not stat.S_ISDIR(info.st_mode)
            or not directory and (not stat.S_ISREG(info.st_mode)
                                  or info.st_nlink != 1 and not allow_system_hardlinks)):
        raise AuditError("PATH_REJECTED")
    resolved = path.resolve(strict=True)
    if not _same_path(path, resolved):
        raise AuditError("PATH_REJECTED")
    return resolved


def _identity(path):
    info = path.stat()
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def _read_image(path, expected_hash):
    path = _checked_path(path)
    before = _identity(path)
    if not 1 <= before[2] <= MAX_FILE_BYTES:
        raise AuditError("BINARY_MISMATCH")
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        if (opened.st_dev, opened.st_ino) != before[:2]:
            raise AuditError("FILE_CHANGED")
        data = source.read(MAX_FILE_BYTES + 1)
    if _identity(path) != before:
        raise AuditError("FILE_CHANGED")
    if len(data) > MAX_FILE_BYTES or hashlib.sha256(data).hexdigest() != expected_hash:
        raise AuditError("BINARY_MISMATCH")
    if data[:2] != b"MZ" or len(data) < 64:
        raise AuditError("PE_REJECTED")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if (pe + 264 > len(data) or data[pe:pe + 4] != b"PE\0\0"
            or struct.unpack_from("<H", data, pe + 4)[0] != 0x8664
            or struct.unpack_from("<H", data, pe + 24)[0] != 0x20B):
        raise AuditError("PE_REJECTED")
    base = struct.unpack_from("<Q", data, pe + 24 + 24)[0]
    image_size = struct.unpack_from("<I", data, pe + 24 + 56)[0]
    return base, image_size, before


def _com_method(pointer, index, argtypes, result_type=ctypes.c_long):
    if not pointer:
        raise AuditError("INTERFACE_FAILED")
    table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(PVOID))).contents
    return ctypes.WINFUNCTYPE(result_type, PVOID, *argtypes)(table[index])


class OfflineEngine:
    def __init__(self):
        _platform()
        self.pointers = {}
        self.dlls = []
        system = _checked_path(Path(os.environ["WINDIR"]) / "System32", directory=True)
        self.kernel = ctypes.WinDLL(str(system / "kernel32.dll"), winmode=0x800)
        self.kernel.SetDefaultDllDirectories.argtypes = [wt.DWORD]
        self.kernel.SetDefaultDllDirectories.restype = wt.BOOL
        self.kernel.SetErrorMode.argtypes = [wt.UINT]
        self.kernel.SetErrorMode.restype = wt.UINT
        self.kernel.GetModuleFileNameW.argtypes = [wt.HMODULE, wt.LPWSTR, wt.DWORD]
        self.kernel.GetModuleFileNameW.restype = wt.DWORD
        self.kernel.SetErrorMode(0x8003)
        if not self.kernel.SetDefaultDllDirectories(0x800):
            raise AuditError("SAFETY_OPTIONS_FAILED")
        try:
            for name in ("dbghelp.dll", "dbgeng.dll"):
                # Serviced Windows DLLs can have legitimate WinSxS hardlinks.
                path = _checked_path(system / name, allow_system_hardlinks=True)
                dll = ctypes.WinDLL(str(path), winmode=0x800)
                loaded_path = ctypes.create_unicode_buffer(32768)
                if (not self.kernel.GetModuleFileNameW(dll._handle, loaded_path, len(loaded_path))
                        or not _same_path(loaded_path.value, path)):
                    raise AuditError("SYSTEM_DLL_REJECTED")
                self.dlls.append(dll)
            dbgeng = self.dlls[-1]
            dbgeng.DebugCreate.argtypes = [ctypes.POINTER(GUID), ctypes.POINTER(PVOID)]
            dbgeng.DebugCreate.restype = ctypes.c_long
            client = PVOID()
            if dbgeng.DebugCreate(ctypes.byref(IID_CLIENT), ctypes.byref(client)) != 0 or not client:
                raise AuditError("DEBUG_CREATE_FAILED")
            self.pointers["client"] = client
            for label, iid in (("control", IID_CONTROL), ("symbols", IID_SYMBOLS)):
                target = PVOID()
                query = _com_method(client, 0, (ctypes.POINTER(GUID), ctypes.POINTER(PVOID)))
                if query(client, ctypes.byref(iid), ctypes.byref(target)) != 0 or not target:
                    raise AuditError("INTERFACE_FAILED")
                self.pointers[label] = target
            self.call("control", "SetEngineOptions", ENGINE_OPTIONS, error="SAFETY_OPTIONS_FAILED")
            actual = wt.ULONG()
            self.call("control", "GetEngineOptions", ctypes.byref(actual), error="SAFETY_OPTIONS_FAILED")
            if actual.value & ENGINE_OPTIONS != ENGINE_OPTIONS or actual.value & 0x4:
                raise AuditError("SAFETY_OPTIONS_FAILED")
            self.call("symbols", "SetSymbolOptions", SYMBOL_OPTIONS, error="SAFETY_OPTIONS_FAILED")
            self.call("symbols", "SetSymbolPath", b"", error="SAFETY_OPTIONS_FAILED")
        except BaseException:
            self.close()
            raise

    def call(self, interface, name, *arguments, error):
        index, types = METHODS[(interface, name)]
        pointer = self.pointers[interface]
        if _com_method(pointer, index, types)(pointer, *arguments) != 0:
            raise AuditError(error)

    def open_image(self, path):
        if ";" in str(path.parent):
            raise AuditError("PATH_REJECTED")
        self.call("symbols", "SetImagePath", str(path.parent).encode("mbcs", errors="strict"), error="SAFETY_OPTIONS_FAILED")
        self.call("client", "OpenDumpFile", str(path).encode("mbcs", errors="strict"), error="OPEN_IMAGE_FAILED")
        self.call("control", "WaitForEvent", 0, 5000, error="WAIT_FAILED")
        kind, qualifier = wt.ULONG(), wt.ULONG()
        self.call("control", "GetDebuggeeType", ctypes.byref(kind), ctypes.byref(qualifier), error="IMAGE_CLASS_REQUIRED")
        if kind.value != 3 or qualifier.value != 1027:
            raise AuditError("IMAGE_CLASS_REQUIRED")
        loaded, unloaded, base = wt.ULONG(), wt.ULONG(), ctypes.c_ulonglong()
        self.call("symbols", "GetNumberModules", ctypes.byref(loaded), ctypes.byref(unloaded), error="IMAGE_CLASS_REQUIRED")
        if loaded.value != 1:
            raise AuditError("IMAGE_CLASS_REQUIRED")
        self.call("symbols", "GetModuleByIndex", 0, ctypes.byref(base), error="IMAGE_CLASS_REQUIRED")
        # An offline image session can map the file at a base different from
        # its PE preferred ImageBase. Use target metadata, never a live process.
        return base.value

    def decode(self, base, start, end, remaining, deadline):
        instructions = []
        cursor = base + start
        while cursor < base + end:
            if len(instructions) >= remaining or time.monotonic() > deadline:
                raise AuditError("INSTRUCTION_LIMIT")
            buffer = ctypes.create_string_buffer(2048)
            needed, following = wt.ULONG(), ctypes.c_ulonglong()
            self.call("control", "Disassemble", cursor, 0, buffer, len(buffer),
                      ctypes.byref(needed), ctypes.byref(following), error="DISASSEMBLY_FAILED")
            if not cursor < following.value <= min(cursor + 15, base + end) or needed.value > len(buffer):
                raise AuditError("DISASSEMBLY_FAILED")
            instruction = assembly_only(buffer.value.decode("ascii", errors="strict"))
            instructions.append({"rva": cursor - base, "assembly": instruction})
            cursor = following.value
        return instructions

    def close(self):
        for name in ("symbols", "control", "client"):
            pointer = self.pointers.pop(name, None)
            if pointer:
                _com_method(pointer, 2, (), wt.ULONG)(pointer)


def assembly_only(text):
    """Drop address/byte columns and any string/symbol annotation suffix."""
    lines = text.strip().splitlines()
    if len(lines) != 1 or len(lines[0]) > 1800:
        raise AuditError("OUTPUT_REJECTED")
    parts = lines[0].split(None, 2)
    if (len(parts) != 3 or not re.fullmatch(r"[0-9A-Fa-f`]{8,17}", parts[0])
            or not re.fullmatch(r"(?:[0-9A-Fa-f]{2}){1,15}", parts[1])):
        raise AuditError("OUTPUT_REJECTED")
    instruction = re.split(r"[;\"']", parts[2], maxsplit=1)[0].strip()
    instruction = re.sub(r"(?i)(?:0x)?[0-9a-f]{24,}", "<redacted-hex>", instruction)
    if (not instruction or len(instruction) > 512
            or any(ord(char) < 32 or ord(char) > 126 for char in instruction)
            or "\\" in instruction or "://" in instruction):
        raise AuditError("OUTPUT_REJECTED")
    return instruction


def fixture_bytes():
    image = bytearray(1024)
    image[:2] = b"MZ"
    struct.pack_into("<I", image, 0x3C, 0x80)
    image[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<HHIIIHH", image, 0x84, 0x8664, 1, 0, 0, 0, 240, 0x22)
    optional = 0x98
    struct.pack_into("<H", image, optional, 0x20B)
    struct.pack_into("<I", image, optional + 4, 0x200)
    struct.pack_into("<IIQII", image, optional + 16, 0x1000, 0x1000, 0x140000000, 0x1000, 0x200)
    struct.pack_into("<HH", image, optional + 40, 6, 0)
    struct.pack_into("<HH", image, optional + 48, 6, 0)
    struct.pack_into("<II", image, optional + 56, 0x2000, 0x200)
    struct.pack_into("<HH", image, optional + 68, 3, 0x160)
    struct.pack_into("<QQQQ", image, optional + 72, 0x100000, 0x1000, 0x100000, 0x1000)
    struct.pack_into("<I", image, optional + 108, 16)
    section = optional + 240
    image[section:section + 8] = b".text\0\0\0"
    struct.pack_into("<IIII", image, section + 8, 4, 0x1000, 0x200, 0x200)
    struct.pack_into("<I", image, section + 36, 0x60000020)
    image[0x200:0x204] = b"\x48\x31\xc0\xc3"
    return bytes(image)


def _fixture_root(value):
    root = _checked_path(value, directory=True)
    parent = _checked_path(Path(tempfile.gettempdir()).resolve(strict=True), directory=True)
    if not _same_path(root.parent, parent) or not root.name.startswith(FIXTURE_PREFIX):
        raise AuditError("PATH_REJECTED")
    if root.is_relative_to(Path(__file__).resolve().parents[3]) or any("onedrive" in part.casefold() for part in root.parts):
        raise AuditError("PATH_REJECTED")
    return root


def run_worker(fixture_root=None):
    engine = None
    try:
        if fixture_root is not None:
            path = _fixture_root(fixture_root) / "fixture.exe"
            expected = hashlib.sha256(fixture_bytes()).hexdigest()
            ranges = (("synthetic", 0x1000, 0x1004),)
        else:
            path = Path(os.environ["LOCALAPPDATA"]) / "Viber" / "Viber.exe"
            expected = EXPECTED_VIBER_SHA256
            ranges = RANGES
        base, image_size, identity = _read_image(path, expected)
        if not all(0 < start < end <= image_size for _, start, end in ranges):
            raise AuditError("PE_REJECTED")
        engine = OfflineEngine()
        base = engine.open_image(path)
        result = []
        remaining = MAX_INSTRUCTIONS
        deadline = time.monotonic() + 25
        for label, start, end in ranges:
            instructions = engine.decode(base, start, end, remaining, deadline)
            remaining -= len(instructions)
            result.append({"label": label, "start_rva": start, "end_rva": end, "instructions": instructions})
        if _identity(path) != identity:
            raise AuditError("FILE_CHANGED")
        if fixture_root is not None:
            instructions = result[0]["instructions"]
            if (len(instructions) != 2 or instructions[0]["rva"] != 0x1000
                    or not re.fullmatch(r"xor\s+rax,rax", instructions[0]["assembly"])
                    or instructions[1] != {"rva": 0x1003, "assembly": "ret"}):
                raise AuditError("FIXTURE_FAILED")
        return {"report_version": 1, "status": "FIXTURE_PASS" if fixture_root else "STATIC_DISASSEMBLY",
                "debuggee_class": 3, "debuggee_qualifier": 1027,
                "header_sha256": HEADER_SHA256, "header_url": HEADER_URL,
                "binary_sha256": expected, "ranges": result,
                "process_attached": False, "target_executed": False,
                "account_files_read": False, "network_paths_disabled": True,
                "module_symbol_loading_disabled": True, "key_recovery_proven": False}
    finally:
        if engine is not None:
            engine.close()


def _worker_environment():
    environment = dict(os.environ)
    for key in tuple(environment):
        if key.upper().startswith(("_NT_SYMBOL", "_NT_ALT_SYMBOL", "_NT_DEBUGGER", "_NT_EXECUTABLE")):
            environment.pop(key, None)
    return environment


def supervise(fixture):
    root = None
    try:
        command = [sys.executable, "-I", "-B", str(Path(__file__).resolve())]
        if fixture:
            root = Path(tempfile.mkdtemp(prefix=FIXTURE_PREFIX))
            root = _fixture_root(root)
            with (root / "fixture.exe").open("xb") as output:
                output.write(fixture_bytes())
                output.flush()
                os.fsync(output.fileno())
            command += ["--fixture-worker", str(root)]
        else:
            command += ["--installed-worker"]
        child = subprocess.run(command, capture_output=True, close_fds=True, timeout=CHILD_TIMEOUT,
                               env=_worker_environment(), creationflags=subprocess.CREATE_NO_WINDOW)
        if len(child.stdout) > MAX_OUTPUT_BYTES:
            raise AuditError("WORKER_FAILED")
        result = json.loads(child.stdout)
        if child.returncode != 0:
            if (isinstance(result, dict) and result.keys() == {"report_version", "status", "error_code"}
                    and result["report_version"] == 1 and result["status"] == "FAILED"
                    and type(result["error_code"]) is str and result["error_code"] in ERROR_CODES):
                raise AuditError(result["error_code"])
            raise AuditError("WORKER_FAILED")
        if not isinstance(result, dict) or result.get("status") not in {"FIXTURE_PASS", "STATIC_DISASSEMBLY"}:
            raise AuditError("OUTPUT_REJECTED")
        return result
    except subprocess.TimeoutExpired:
        raise AuditError("WORKER_TIMEOUT") from None
    finally:
        if root is not None:
            root = _fixture_root(root)
            target = root / "fixture.exe"
            if target.exists():
                _checked_path(target).unlink()
            root.rmdir()


def main():
    _platform()
    if sys.argv[1:] == ["--self-test"]:
        return supervise(True)
    if sys.argv[1:] == ["--installed"]:
        raise AuditError("ARGUMENTS_REJECTED")  # Owned fixture did not decode; target mode disabled.
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture-worker":
        return run_worker(sys.argv[2])
    if sys.argv[1:] == ["--installed-worker"]:
        raise AuditError("ARGUMENTS_REJECTED")
    raise AuditError("ARGUMENTS_REJECTED")


if __name__ == "__main__":
    try:
        print(json.dumps(main(), separators=(",", ":")), flush=True)
    except Exception as failure:
        print(json.dumps({"report_version": 1, "status": "FAILED",
                          "error_code": failure.code if isinstance(failure, AuditError) else "WORKER_FAILED"}), flush=True)
        raise SystemExit(2) from None
