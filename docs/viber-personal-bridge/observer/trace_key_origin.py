"""Bounded static xref discovery in one hash-pinned installed Viber executable.

Reads PE data only. Byte patterns identify candidates; they are not a decoded
call graph, runtime evidence, or permission to dereference a live process.
No account/config/registry/process access and no binary execution.
"""

import bisect
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct

from inspect_recovery_binary import PE, MAX_FILE


EXPECTED_SHA = "7c6f4f7c463e631f43590a189ee40e3cad733759afd04d89fc80e25ae610f99b"
LITERAL = b"PRAGMA hexkey='%1'"
MAX_FUNCTION = 32768
MAX_FUNCTIONS = 250000
MAX_XREFS = 256
SELECTED_CLASSES = ("QSqlQuery", "QSqlDatabase", "QSqlDriver", "QString", "QByteArray", "QSettings")
FIXED_LITERALS = (
    "DPAPI", "os_crypt", "encrypted_key", "os_crypt.encrypted_key",
    "Local State", "Cookies", "Login Data", "Chrome", "Chromium",
    "password_value", "encrypted_value", "viber.db",
    "PRAGMA hexkey='%1'", "PRAGMA rekey='%1'", "PRAGMA hexrekey='%1'",
)


def read_installed():
    path = Path(os.environ["LOCALAPPDATA"]) / "Viber" / "Viber.exe"
    for item in (path, *path.parents):
        if item.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError("REPARSE_PATH")
    if path.resolve(strict=True) != path.absolute():
        raise ValueError("REDIRECTED_PATH")
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= MAX_FILE:
        raise ValueError("BINARY_BOUND")
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    with path.open("rb") as source:
        if identity(before) != identity(os.fstat(source.fileno())):
            raise ValueError("BINARY_CHANGED")
        data = source.read(MAX_FILE + 1)
        if identity(before) != identity(os.fstat(source.fileno())) or identity(before) != identity(path.stat()):
            raise ValueError("BINARY_CHANGED")
    if len(data) > MAX_FILE or hashlib.sha256(data).hexdigest() != EXPECTED_SHA:
        raise ValueError("BINARY_HASH_MISMATCH")
    return data


class Image(PE):
    def __init__(self, data):
        super().__init__(data)
        pe = self.u32(0x3C)
        optional = pe + 24
        self.base = self.u64(optional + 24)
        section = optional + self.u16(pe + 20)
        self.code_sections = []
        for index, (virtual, size, raw) in enumerate(self.sections):
            if self.u32(section + index * 40 + 36) & 0x20000000:
                self.code_sections.append((virtual, size, raw))
        address, size = self.directories[3]
        if size % 12 or size // 12 > MAX_FUNCTIONS:
            raise ValueError("EXCEPTION_DIRECTORY_BOUND")
        self.functions = []
        for index in range(size // 12):
            offset = self.rva(address + index * 12, 12)
            begin, end = self.u32(offset), self.u32(offset + 4)
            if not begin < end or not self.is_code(begin) or not self.is_code(end - 1):
                raise ValueError("FUNCTION_RANGE_INVALID")
            self.functions.append((begin, end))
        self.functions.sort()
        self.starts = [value[0] for value in self.functions]
        self.import_slots = self.import_map()
        self.literal_targets = {}
        for label in FIXED_LITERALS:
            for encoding in ("ascii", "utf-16-le"):
                needle = label.encode(encoding) + (b"\0" if encoding == "ascii" else b"\0\0")
                start = 0
                for _index in range(1024):
                    offset = self.data.find(needle, start)
                    if offset < 0:
                        break
                    self.literal_targets.setdefault(self.file_rva(offset), []).append(label)
                    start = offset + 1
                else:
                    raise ValueError("LITERAL_COUNT_BOUND")

    def file_rva(self, offset):
        for virtual, size, raw in self.sections:
            if raw <= offset < raw + size:
                return virtual + offset - raw
        raise ValueError("FILE_RVA_UNMAPPED")

    def is_code(self, address):
        return any(begin <= address < begin + size for begin, size, _raw in self.code_sections)

    def function_at(self, address):
        index = bisect.bisect_right(self.starts, address) - 1
        if index >= 0 and address < self.functions[index][1]:
            return self.functions[index]
        return None

    def import_map(self):
        address, size = self.directories[1]
        result = {}
        for index in range(min(size // 20, 4096)):
            descriptor = self.rva(address + index * 20, 20)
            if not any(self.part(descriptor, 20)):
                return result
            source = self.u32(descriptor) or self.u32(descriptor + 16)
            target = self.u32(descriptor + 16)
            for slot in range(65536):
                value = self.u64(self.rva(source + slot * 8, 8))
                if value == 0:
                    break
                if not value & (1 << 63):
                    if len(result) >= 65536:
                        raise ValueError("IMPORT_COUNT_BOUND")
                    result[target + slot * 8] = self.string(self.rva(value, 3) + 2)
            else:
                raise ValueError("IMPORT_THUNK_UNTERMINATED")
        raise ValueError("IMPORT_DIRECTORY_UNTERMINATED")

    def xrefs(self, target, pattern, displacement_offset, instruction_size):
        matches = []
        for virtual, size, raw in self.code_sections:
            block = self.part(raw, size)
            for match in re.finditer(b"(?=" + pattern + b")", block, re.DOTALL):
                start = match.start()
                if start + instruction_size > len(block):
                    continue
                delta = struct.unpack_from("<i", block, start + displacement_offset)[0]
                if virtual + start + instruction_size + delta == target:
                    matches.append(virtual + start)
                    if len(matches) > MAX_XREFS:
                        raise ValueError("XREF_COUNT_BOUND")
        return matches

    def import_candidates(self, function):
        begin, end = function
        if end - begin > MAX_FUNCTION:
            raise ValueError("FUNCTION_SIZE_BOUND")
        block = self.part(self.rva(begin, end - begin), end - begin)
        result = []
        for match in re.finditer(rb"\xff[\x15\x25]....", block, re.DOTALL):
            address = begin + match.start()
            target = address + 6 + struct.unpack_from("<i", block, match.start() + 2)[0]
            name = self.import_slots.get(target)
            if name and (name == "CryptUnprotectData" or any(f"@{item}@" in name for item in SELECTED_CLASSES)):
                result.append({"instruction_rva": hex(address), "import": name})
        return result

    def literal_candidates(self, function):
        begin, end = function
        if not 0 < end - begin <= MAX_FUNCTION:
            raise ValueError("FUNCTION_SIZE_BOUND")
        block = self.part(self.rva(begin, end - begin), end - begin)
        result = []
        for match in re.finditer(rb"[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]....", block, re.DOTALL):
            address = begin + match.start()
            target = address + 7 + struct.unpack_from("<i", block, match.start() + 3)[0]
            for name in self.literal_targets.get(target, []):
                result.append({"instruction_rva": hex(address), "literal": name})
        return result


def run():
    image = Image(read_installed())
    if image.data.count(LITERAL) != 1:
        raise ValueError("TEMPLATE_NOT_UNIQUE")
    literal_rva = image.file_rva(image.data.index(LITERAL))
    # LEA r64,[RIP+disp32], CALL/JMP [RIP+disp32]; instruction boundaries have
    # not been independently decoded at this discovery stage.
    lea_pattern = rb"[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]...."
    template_xrefs = image.xrefs(literal_rva, lea_pattern, 3, 7)
    dpapi_slots = [slot for slot, name in image.import_slots.items() if name == "CryptUnprotectData"]
    dpapi_xrefs = []
    for slot in dpapi_slots:
        dpapi_xrefs.extend(image.xrefs(slot, rb"\xff[\x15\x25]....", 2, 6))
    candidate_functions = {}
    for kind, refs in (("hexkey_template", template_xrefs), ("dpapi_import", dpapi_xrefs)):
        for address in refs:
            function = image.function_at(address)
            if function:
                key = hex(function[0])
                item = candidate_functions.setdefault(key, {
                    "function_begin_rva": key, "function_end_rva": hex(function[1]),
                    "function_size_bytes": function[1] - function[0],
                    "references": [], "selected_import_candidates": image.import_candidates(function),
                    "selected_literal_candidates": image.literal_candidates(function),
                })
                item["references"].append({"kind": kind, "instruction_rva": hex(address)})
    callers = []
    # Only one level around the discovered template owner; adaptive decoding
    # must validate instruction boundaries before following this as data flow.
    template_functions = {image.function_at(address) for address in template_xrefs}
    for function in template_functions - {None}:
        for address in image.xrefs(function[0], rb"\xe8....", 1, 5):
            caller = image.function_at(address)
            if caller and caller[1] - caller[0] <= MAX_FUNCTION:
                callers.append({
                    "call_instruction_rva": hex(address), "target_function_rva": hex(function[0]),
                    "caller_begin_rva": hex(caller[0]), "caller_end_rva": hex(caller[1]),
                    "selected_import_candidates": image.import_candidates(caller),
                    "selected_literal_candidates": image.literal_candidates(caller),
                })
    return {
        "report_version": 1, "status": "STATIC_XREF_CANDIDATES",
        "binary_sha256": EXPECTED_SHA, "runtime_function_count": len(image.functions),
        "template_rva": hex(literal_rva), "template_xref_count": len(template_xrefs),
        "dpapi_import_slot_count": len(dpapi_slots), "dpapi_xref_count": len(dpapi_xrefs),
        "candidate_functions": list(candidate_functions.values()),
        "template_direct_caller_candidates": callers,
        "instruction_boundaries_verified": False, "data_flow_verified": False,
        "live_key_recovery_verified": False, "account_files_read": False,
        "process_memory_read": False, "viber_code_executed": False,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(run(), separators=(",", ":")))
    except Exception:
        print('{"report_version":1,"status":"STATIC_XREF_FAILED"}')
        raise SystemExit(2) from None
