"""Pinned temporary Capstone DLL: synthetic gate, then offline PE data only.

No Python package import, installer, Viber execution/process/account access.
Run in an externally timed child. The allowlist contains static .pdata ranges.
"""

import argparse
import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import zipfile

from inspect_recovery_binary import PE
from prepare_capstone_runtime import NAME, SHA256, SIZE
from trace_key_origin import Image, read_installed, EXPECTED_SHA, MAX_FUNCTION


DLL_SHA = "76958e18380023a68fd1714fa2e01c594cc6db1955a07ad6937b66e66dc5d6c3"
# Last two are direct, decoded key-return callees at 0x32d578/0x32d63c.
FUNCTIONS = (0x340290, 0x32d550, 0x3409e0, 0x82ee00, 0x82f580, 0x340fd0, 0x341420,
             0x519a20, 0x519390)
# Direct decoded callees without .pdata entries: bounded instruction windows,
# explicitly not a claim of complete function boundaries.
LEAF_WINDOWS = ((0x14e09f0, 0xed), (0x340fa0, 48))


class Instruction(c.Structure):
    # Exact cs_insn layout from the hash-pinned wheel's capstone.h.
    _fields_ = [("id", c.c_uint), ("address", c.c_uint64), ("size", c.c_uint16),
                ("bytes", c.c_ubyte * 24), ("mnemonic", c.c_char * 32),
                ("op_str", c.c_char * 160), ("detail", c.c_void_p)]


def guarded(path):
    if not path.is_absolute() or path.resolve(strict=True) != path.absolute():
        raise ValueError("PATH_REDIRECTED")
    for item in (path, *path.parents):
        if item.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError("REPARSE_PATH")
    return path


class Decoder:
    def __init__(self, bindings):
        root = guarded(Path(bindings))
        if root.name != "bindings" or not root.parent.name.startswith("eventgenix-capstone-static-"):
            raise ValueError("NOT_PREPARED_RUNTIME")
        archive = guarded(root.parent / NAME)
        if archive.stat().st_size != SIZE or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
            raise ValueError("WHEEL_HASH_MISMATCH")
        dll = guarded(root / "capstone/lib/capstone.dll")
        if dll.stat().st_size != 7576576:
            raise ValueError("DLL_SIZE_MISMATCH")
        data = dll.read_bytes()
        if hashlib.sha256(data).hexdigest() != DLL_SHA:
            raise ValueError("DLL_HASH_MISMATCH")
        with zipfile.ZipFile(archive) as wheel:
            if wheel.read("capstone/lib/capstone.dll") != data:
                raise ValueError("DLL_ARCHIVE_MISMATCH")
        pe = PE(data)
        self.imports = pe.imports() + pe.imports(delayed=True)
        # Absolute path; dependent modules may resolve only beside DLL/System32.
        self.lib = c.CDLL(str(dll), winmode=0x900)
        kernel = c.WinDLL("kernel32", use_last_error=True)
        kernel.GetModuleFileNameW.argtypes = [c.c_void_p, c.c_wchar_p, c.c_uint]
        kernel.GetModuleFileNameW.restype = c.c_uint
        buffer = c.create_unicode_buffer(32768)
        count = kernel.GetModuleFileNameW(self.lib._handle, buffer, len(buffer))
        if not 0 < count < len(buffer) or guarded(Path(buffer.value)) != dll:
            raise ValueError("LOADED_DLL_PATH_MISMATCH")
        if hashlib.sha256(dll.read_bytes()).hexdigest() != DLL_SHA:
            raise ValueError("LOADED_DLL_FILE_CHANGED")
        pointer = c.POINTER(Instruction)
        for name, result, args in (
            ("cs_version", c.c_int, [c.POINTER(c.c_int), c.POINTER(c.c_int)]),
            ("cs_open", c.c_int, [c.c_uint, c.c_uint, c.POINTER(c.c_size_t)]),
            ("cs_disasm", c.c_size_t, [c.c_size_t, c.POINTER(c.c_char), c.c_size_t,
                                     c.c_uint64, c.c_size_t, c.POINTER(pointer)]),
            ("cs_free", None, [c.c_void_p, c.c_size_t]),
            ("cs_close", c.c_int, [c.POINTER(c.c_size_t)]),
        ):
            function = getattr(self.lib, name)
            function.restype, function.argtypes = result, args
        major, minor = c.c_int(), c.c_int()
        self.lib.cs_version(c.byref(major), c.byref(minor))
        if (major.value, minor.value) != (5, 0) or c.sizeof(Instruction) != 248:
            raise ValueError("DECODER_ABI_MISMATCH")

    def decode(self, data, address, require_complete=True):
        if not 0 < len(data) <= MAX_FUNCTION:
            raise ValueError("DECODE_BOUND")
        handle = c.c_size_t()
        if self.lib.cs_open(3, 8, c.byref(handle)) != 0:  # X86, MODE_64
            raise ValueError("DECODER_OPEN_FAILED")
        instructions = c.POINTER(Instruction)()
        count = 0
        try:
            buffer = c.create_string_buffer(data)
            count = self.lib.cs_disasm(handle, buffer, len(data), address, len(data), c.byref(instructions))
            if not 0 < count <= len(data) or not instructions:
                raise ValueError("DECODE_FAILED")
            result, consumed = [], 0
            for index in range(count):
                item = instructions[index]
                if item.address != address + consumed or not 1 <= item.size <= 15:
                    raise ValueError("INSTRUCTION_BOUNDARY_INVALID")
                if bytes(item.bytes[:item.size]) != data[consumed:consumed + item.size]:
                    raise ValueError("INSTRUCTION_BYTES_MISMATCH")
                result.append({"rva": hex(item.address), "size": item.size,
                               "mnemonic": item.mnemonic.decode("ascii"),
                               "operands": item.op_str.decode("ascii")})
                consumed += item.size
            if require_complete and consumed != len(data):
                raise ValueError("INCOMPLETE_DECODE")
            return result
        finally:
            if instructions:
                self.lib.cs_free(instructions, count)
            self.lib.cs_close(c.byref(handle))


def rip_target(item):
    match = re.search(r"\[rip(?: ([+-]) (0x[0-9a-f]+|[0-9]+))?\]", item["operands"])
    if match:
        delta = int(match[2], 0) * (1 if match[1] == "+" else -1) if match[2] else 0
        return int(item["rva"], 16) + item["size"] + delta
    return None


def synthetic(decoder):
    items = decoder.decode(bytes.fromhex("4831c0c3"), 0x1000)
    if [(i["mnemonic"], i["operands"], i["size"]) for i in items] != [("xor", "rax, rax", 3), ("ret", "", 1)]:
        raise ValueError("SYNTHETIC_MNEMONIC_FAILED")
    items = decoder.decode(bytes.fromhex("488d05f9ffffff" "ff15f3ffffff" "e8eeffffff" "488b8188000000"), 0x2000)
    if (rip_target(items[0]), rip_target(items[1]), items[2]["operands"], items[3]["operands"]) != (
            0x2000, 0x2000, "0x2000", "rax, qword ptr [rcx + 0x88]"):
        raise ValueError("SYNTHETIC_ADDRESS_FAILED")
    return 6


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bindings", required=True)
    parser.add_argument("--installed", action="store_true")
    options = parser.parse_args()
    decoder = Decoder(options.bindings)
    result = {"status": "SYNTHETIC_PASS", "synthetic_instructions": synthetic(decoder),
              "wheel_sha256": SHA256, "dll_sha256": DLL_SHA, "loaded_dll_path_verified": True,
              "native_imports": decoder.imports, "account_accessed": False,
              "process_accessed": False, "viber_code_executed": False, "functions": []}
    if options.installed:
        image = Image(read_installed())
        ranges = []
        for begin in FUNCTIONS:
            bounds = image.function_at(begin)
            if not bounds or bounds[0] != begin or bounds[1] - begin > MAX_FUNCTION:
                raise ValueError("FUNCTION_ALLOWLIST_INVALID")
            ranges.append((begin, bounds[1], True))
        ranges.extend((begin, begin + size, False) for begin, size in LEAF_WINDOWS)
        for begin, end, complete in ranges:
            if not image.is_code(begin) or not image.is_code(end - 1):
                raise ValueError("WINDOW_NOT_CODE")
            data = image.part(image.rva(begin, end - begin), end - begin)
            decoded = decoder.decode(data, begin, require_complete=complete)
            for item in decoded:
                target = rip_target(item)
                if target in image.import_slots:
                    item["import"] = image.import_slots[target]
                if target in image.literal_targets:
                    item["fixed_literal"] = image.literal_targets[target]
            result["functions"].append({"begin": hex(begin), "end": hex(end),
                                        "complete_pdata_function": complete, "instructions": decoded})
        result.update(status="STATIC_DECODE_PASS", binary_sha256=EXPECTED_SHA)
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"status":"DECODE_FAILED"}')
        raise SystemExit(2) from None
