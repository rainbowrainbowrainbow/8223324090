"""Read installed PE files as data; emit only fixed identifiers and counters.

No DLL loading, account files, process memory, subprocesses, or network access.
This is a static feasibility aid, not a key extractor or disassembler.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct


FILES = ("Viber.exe", "Qt6Core.dll", "Qt6Sql.dll", "plugins/sqldrivers/qsqlite.dll")
MAX_FILE = 128 * 1024 * 1024
IDENTIFIERS = (
    "hexkey", "textkey", "CODEC=see", "HAS_CODEC", "SQLCipher", "Botan",
    "sqlite3_key", "sqlite3_key_v2", "sqlite3_rekey", "sqlite3_rekey_v2",
    "sqlite3CodecGetKey", "sqlite3_activate_see", "sqlite3_db_config",
    "sqlite3_db_filename", "CryptProtectData", "CryptUnprotectData",
    "NCryptUnprotectSecret", "BCryptDecrypt", "QSQLITE_OPEN_READONLY",
)
IMPORT_IDENTIFIERS = (
    "CryptProtectData", "CryptUnprotectData", "NCryptUnprotectSecret",
    "BCryptDecrypt", "sqlite3_key", "sqlite3_key_v2", "sqlite3_rekey",
    "sqlite3_rekey_v2", "sqlite3CodecGetKey", "sqlite3_activate_see",
)
QT_IMPORT_CLASSES = ("QSqlQuery", "QSqlDatabase", "QSqlDriver", "QSettings")


class PE:
    def __init__(self, data: bytes):
        self.data = data
        if data[:2] != b"MZ":
            raise ValueError("NOT_PE")
        pe = self.u32(0x3C)
        if self.part(pe, 4) != b"PE\0\0" or self.u16(pe + 4) != 0x8664:
            raise ValueError("NOT_X64_PE")
        count = self.u16(pe + 6)
        optional = pe + 24
        optional_size = self.u16(pe + 20)
        if not 1 <= count <= 96 or optional_size < 240 or self.u16(optional) != 0x20B:
            raise ValueError("INVALID_PE_HEADERS")
        self.part(optional, optional_size)
        directory_count = self.u32(optional + 108)
        if directory_count < 14:
            raise ValueError("MISSING_PE_DIRECTORIES")
        self.directories = [
            (self.u32(optional + 112 + index * 8), self.u32(optional + 116 + index * 8))
            for index in range(14)
        ]
        self.sections = []
        section = optional + optional_size
        for index in range(count):
            start = section + index * 40
            self.part(start, 40)
            virtual = self.u32(start + 12)
            size = self.u32(start + 16)
            raw = self.u32(start + 20)
            self.part(raw, size)
            self.sections.append((virtual, size, raw))

    def part(self, offset: int, size: int) -> bytes:
        if offset < 0 or size < 0 or offset + size > len(self.data):
            raise ValueError("PE_OUT_OF_BOUNDS")
        return self.data[offset:offset + size]

    def u16(self, offset: int) -> int:
        return struct.unpack("<H", self.part(offset, 2))[0]

    def u32(self, offset: int) -> int:
        return struct.unpack("<I", self.part(offset, 4))[0]

    def u64(self, offset: int) -> int:
        return struct.unpack("<Q", self.part(offset, 8))[0]

    def rva(self, value: int, size: int = 1) -> int:
        for virtual, raw_size, raw in self.sections:
            if virtual <= value and value + size <= virtual + raw_size:
                return raw + value - virtual
        raise ValueError("UNMAPPED_PE_RVA")

    def string(self, offset: int) -> str:
        end = self.data.find(b"\0", offset, min(offset + 4096, len(self.data)))
        if offset < 0 or end < offset:
            raise ValueError("INVALID_PE_STRING")
        return self.data[offset:end].decode("ascii", errors="strict")

    def imports(self, delayed: bool = False) -> list[str]:
        address, size = self.directories[13 if delayed else 1]
        if address == 0:
            return []
        stride = 32 if delayed else 20
        if size < stride:
            raise ValueError("INVALID_IMPORT_DIRECTORY")
        result = []
        for index in range(min(size // stride, 4096)):
            descriptor = self.rva(address + index * stride, stride)
            if not any(self.part(descriptor, stride)):
                return result
            if delayed:
                if self.u32(descriptor) != 1:
                    raise ValueError("UNSUPPORTED_DELAY_IMPORT_MODE")
                thunk = self.u32(descriptor + 16)
            else:
                thunk = self.u32(descriptor) or self.u32(descriptor + 16)
            for slot in range(65536):
                value = self.u64(self.rva(thunk + slot * 8, 8))
                if value == 0:
                    break
                if not value & (1 << 63):
                    if len(result) >= 65536:
                        raise ValueError("TOTAL_IMPORT_COUNT_LIMIT")
                    result.append(self.string(self.rva(value, 3) + 2))
            else:
                raise ValueError("UNTERMINATED_IMPORT_THUNK")
        raise ValueError("UNTERMINATED_IMPORT_DIRECTORY")

    def exports(self) -> list[str]:
        address, _size = self.directories[0]
        if address == 0:
            return []
        start = self.rva(address, 40)
        count = self.u32(start + 24)
        names = self.u32(start + 32)
        if count > 65536:
            raise ValueError("EXPORT_COUNT_LIMIT")
        return [self.string(self.rva(self.u32(self.rva(names + index * 4, 4))))
                for index in range(count)]


def audit(path: Path, label: str) -> dict:
    # Refuse redirected installation paths before opening binary data. File-ID
    # continuity detects ordinary concurrent replacement, not hostile OS races.
    for item in (path, *path.parents):
        if item.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError("REPARSE_INSTALL_PATH")
    if path.resolve(strict=True) != path.absolute():
        raise ValueError("REDIRECTED_INSTALL_PATH")
    initial = path.stat()
    if not stat.S_ISREG(initial.st_mode) or not 1 <= initial.st_size <= MAX_FILE:
        raise ValueError("FILE_UNAVAILABLE_OR_TOO_LARGE")
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        if (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns) != (
                opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns):
            raise ValueError("BINARY_CHANGED_BEFORE_READ")
        data = source.read(MAX_FILE + 1)
        final = os.fstat(source.fileno())
        current = path.stat()
        if any((value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns) != (
                opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) for value in (final, current)):
            raise ValueError("BINARY_CHANGED_DURING_READ")
    if len(data) > MAX_FILE:
        raise ValueError("FILE_TOO_LARGE")
    pe = PE(data)
    imports = pe.imports()
    delayed = pe.imports(delayed=True)
    exports = pe.exports()
    # All output keys are fixed allowlisted labels. No raw binary strings escape.
    literals = {
        item: {"ascii": data.count(item.encode("ascii")),
               "utf16le": data.count(item.encode("utf-16-le"))}
        for item in IDENTIFIERS
    }
    formats = {}
    for key in ("hexkey", "textkey", "key"):
        for quote, quote_name in (("'", "single_quote"), ('"', "double_quote")):
            pattern = rf"PRAGMA[ \t]+{key}[ \t]*=[ \t]*{quote}%1{quote}"
            matches = sum(1 for _ in re.finditer(pattern.encode("ascii"), data, re.IGNORECASE))
            wide_pattern = (re.escape("PRAGMA".encode("utf-16-le")) + rb"(?:[ \t]\x00)+"
                            + re.escape(key.encode("utf-16-le")) + rb"(?:[ \t]\x00)*=\x00(?:[ \t]\x00)*"
                            + re.escape(f"{quote}%1{quote}".encode("utf-16-le")))
            wide_matches = sum(1 for _ in re.finditer(wide_pattern, data, re.IGNORECASE))
            formats[f"{key}_percent1_{quote_name}"] = {"ascii": matches, "utf16le": wide_matches}
    return {
        "file": label,
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "pe_architecture": "x64",
        "named_export_count": len(exports),
        "sqlite_named_export_count": sum(name.startswith("sqlite3") for name in exports),
        "qt_plugin_exports": [name for name in ("qt_plugin_instance", "qt_plugin_query_metadata_v2") if name in exports],
        "named_import_count": len(imports),
        "named_delay_import_count": len(delayed),
        "selected_imports": [name for name in IMPORT_IDENTIFIERS if name in imports or name in delayed],
        "qt_import_class_counts": {name: sum(f"@{name}@" in item for item in imports + delayed) for name in QT_IMPORT_CLASSES},
        "literal_occurrences": literals,
        "sql_format_occurrences": formats,
    }


def main() -> None:
    root = Path(os.environ["LOCALAPPDATA"]) / "Viber"
    reports = [audit(root / name, name) for name in FILES]
    print(json.dumps({
        "report_version": 1,
        "status": "STATIC_ONLY",
        "files": reports,
        "account_files_read": False,
        "process_memory_read": False,
        "installed_code_executed": False,
        "private_values_saved": False,
        "key_recovery_proven": False,
    }, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"report_version":1,"status":"STATIC_AUDIT_FAILED"}')
        raise SystemExit(2) from None
