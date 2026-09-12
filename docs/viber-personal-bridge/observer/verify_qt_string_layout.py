"""Synthetic Qt string ABI check; run only in an externally timed fresh child.

Loads only the hash-pinned installed Qt6Core.dll, not Viber or its SQL plugin.
Static fromRawData factories wrap our own buffers. There is no process-memory
access, account access, database opening, application creation or file write.
No native addresses, synthetic input strings or raw errors are printed.
"""

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import struct


EXPECTED_CORE_SHA256 = "2c9a13c52245d8bcb5252b3c38975cdb2d22503ef7aaa6de161eeac1b6c38416"
SYMBOLS = {
    "qstring": "?fromRawData@QString@@SA?AV1@PEBVQChar@@_J@Z",
    "qbytearray": "?fromRawData@QByteArray@@SA?AV1@PEBD_J@Z",
}
OBJECT_BYTES = 24
CANARY = 0xA5


class ABIProbeFailure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class GuardedBuffer:
    """Own memory with at least 32 canary bytes on each side of its payload."""

    def __init__(self, payload):
        self.buffer = ctypes.create_string_buffer(len(payload) + 79)
        base = ctypes.addressof(self.buffer)
        self.address = (base + 32 + 15) & ~15
        self.offset = self.address - base
        self.length = len(payload)
        ctypes.memset(base, CANARY, ctypes.sizeof(self.buffer))
        ctypes.memmove(self.address, payload, self.length)
        self.initial = bytes(self.buffer)

    def guards_unchanged(self):
        value = bytes(self.buffer)
        end = self.offset + self.length
        return value[:self.offset] == self.initial[:self.offset] and value[end:] == self.initial[end:]

    def entirely_unchanged(self):
        return bytes(self.buffer) == self.initial

    def payload(self):
        return bytes(self.buffer)[self.offset:self.offset + self.length]


def _hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _module_path(kernel32, handle):
    kernel32.GetModuleFileNameW.argtypes = [wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    kernel32.GetModuleFileNameW.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    length = kernel32.GetModuleFileNameW(handle, buffer, len(buffer))
    if not length or length >= len(buffer):
        raise ABIProbeFailure("ABI_MODULE_PATH_FAILED")
    return Path(buffer.value).resolve(strict=True)


def _verify_factory(module, symbol, data, units):
    source = GuardedBuffer(data)
    output = GuardedBuffer(bytes(OBJECT_BYTES))
    factory = getattr(module, symbol)
    # Both methods are static. Microsoft x64 uses an implicit sret pointer
    # first, followed by data pointer and signed 64-bit qsizetype length.
    factory.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int64]
    factory.restype = ctypes.c_void_p
    returned = factory(output.address, source.address, units)
    if not output.guards_unchanged() or not source.entirely_unchanged():
        raise ABIProbeFailure("ABI_GUARD_CHANGED")
    header_pointer, data_pointer, size = struct.unpack("<QQq", output.payload())
    if returned != output.address:
        raise ABIProbeFailure("ABI_RETURN_STORAGE_MISMATCH")
    if header_pointer != 0 or data_pointer != source.address or size != units:
        raise ABIProbeFailure("ABI_DESCRIPTOR_MISMATCH")
    # Keep source alive through all checks. With verified d == nullptr these
    # raw-data values own no Qt allocation; no C++ destructor call is needed.
    # If any check fails, do not attempt destructor/repair on an unknown object.
    return {
        "static_factory_called": True, "return_storage_verified": True,
        "allocation_header_null": True, "data_pointer_matches_owned_input": True,
        "length_matches_input_units": True, "output_guards_unchanged": True,
        "input_unchanged": True,
    }


def verify():
    if os.name != "nt" or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise ABIProbeFailure("ABI_WINDOWS_X64_REQUIRED")
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise ABIProbeFailure("ABI_INSTALL_PATH_UNAVAILABLE")
    core_path = (Path(local_app_data) / "Viber" / "Qt6Core.dll").resolve(strict=True)
    if _hash(core_path) != EXPECTED_CORE_SHA256:
        raise ABIProbeFailure("ABI_CORE_HASH_MISMATCH")

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True, winmode=0x800)
    kernel32.SetErrorMode.argtypes = [wintypes.UINT]
    kernel32.SetErrorMode.restype = wintypes.UINT
    kernel32.SetErrorMode(0x8003)
    # LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32.
    # No process-wide DLL path or environment changes and no Qt application.
    module = ctypes.WinDLL(str(core_path), winmode=0x900)
    loaded_path = _module_path(kernel32, module._handle)
    if os.path.normcase(str(loaded_path)) != os.path.normcase(str(core_path)):
        raise ABIProbeFailure("ABI_LOADED_PATH_MISMATCH")
    if _hash(loaded_path) != EXPECTED_CORE_SHA256:
        raise ABIProbeFailure("ABI_LOADED_HASH_MISMATCH")

    # Include an embedded null in both types and a surrogate pair in QString;
    # the stored length must be explicit units, not strlen or Unicode scalars.
    token = secrets.token_hex(8)
    ascii_input = ("EGX-ABI-" + token + "\0END").encode("ascii")
    utf16_input = ("EGX-ABI-" + token + "-\u0416\U0001f600\0END").encode("utf-16-le")
    qstring = _verify_factory(module, SYMBOLS["qstring"], utf16_input, len(utf16_input) // 2)
    qbytearray = _verify_factory(module, SYMBOLS["qbytearray"], ascii_input, len(ascii_input))
    if _module_path(kernel32, module._handle) != loaded_path or _hash(loaded_path) != EXPECTED_CORE_SHA256:
        raise ABIProbeFailure("ABI_MODULE_CHANGED")
    return {
        "scope": "SYNTHETIC_ONLY", "status": "PASS",
        "hash_matches_preflight_qt_6_8_3": True, "loaded_core_path_verified": True,
        "static_factories_called": 2, "object_size_bytes": OBJECT_BYTES,
        "allocation_header_offset": 0, "data_pointer_offset": 8, "signed_length_offset": 16,
        "qstring_length_unit": "UTF16_CODE_UNITS", "qbytearray_length_unit": "BYTES",
        "qstring": qstring, "qbytearray": qbytearray,
        "qt_application_created": False, "sql_plugin_loaded_by_probe": False,
        "viber_process_accessed": False, "private_database_opened": False,
        "account_keys_used": False, "viber_owner_field_verified": False,
        "messages_sent": 0,
    }


def main():
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    try:
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument("--worker", action="store_true", required=True)
        parser.parse_args()
        result = verify()
    except ABIProbeFailure as failure:
        result = {"scope": "SYNTHETIC_ONLY", "status": "FAIL", "error_code": failure.code}
    except SystemExit:
        result = {"scope": "SYNTHETIC_ONLY", "status": "FAIL", "error_code": "ABI_ARGUMENTS"}
    except BaseException:
        result = {"scope": "SYNTHETIC_ONLY", "status": "FAIL", "error_code": "ABI_PROBE_FAILED"}
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
