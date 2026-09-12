"""Synthetic byte-pattern checks; no installed binary or private source reads."""

import json
import struct
import unittest
from unittest.mock import Mock, patch

import trace_key_origin as trace


BASE = 0x1000
LEA = rb"[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]...."
INDIRECT = rb"\xff[\x15\x25]...."
DIRECT = rb"\xe8...."


def instruction(opcode, address, target):
    return opcode + struct.pack("<i", target - address - len(opcode) - 4)


def synthetic_image(data, code_size=None):
    """Use the actual parsing methods without invoking PE/file initialization."""
    image = trace.Image.__new__(trace.Image)
    image.data = bytes(data)
    image.base = 0x140000000
    image.sections = [(BASE, len(data), 0)]
    image.code_sections = [(BASE, len(data) if code_size is None else code_size, 0)]
    image.functions = [(BASE, BASE + len(data))]
    image.starts = [BASE]
    image.import_slots = {}
    image.literal_targets = {}
    return image


class KeyOriginTests(unittest.TestCase):
    def test_signed_backward_displacements_use_next_instruction_address(self):
        target = BASE - 33
        for opcode, pattern, offset in ((b"\x48\x8d\x0d", LEA, 3),
                                        (b"\xff\x15", INDIRECT, 2), (b"\xe8", DIRECT, 1)):
            with self.subTest(opcode=opcode.hex()):
                encoded = instruction(opcode, BASE, target)
                image = synthetic_image(encoded)
                self.assertEqual(image.xrefs(target, pattern, offset, len(encoded)), [BASE])
                self.assertEqual(image.xrefs(target + 1, pattern, offset, len(encoded)), [])

    def test_newline_displacement_bytes_match_all_candidate_scanners(self):
        data = bytearray(b"\x90" * 40)
        literal_target = BASE + 7 + 10
        import_target = BASE + 16 + 6 + 10
        data[:7] = instruction(b"\x48\x8d\x0d", BASE, literal_target)
        data[16:22] = instruction(b"\xff\x15", BASE + 16, import_target)
        self.assertEqual(data[3], 0x0A)
        self.assertEqual(data[18], 0x0A)
        image = synthetic_image(data)
        image.literal_targets = {literal_target: ["DPAPI"]}
        image.import_slots = {import_target: "CryptUnprotectData"}
        self.assertEqual(image.xrefs(literal_target, LEA, 3, 7), [BASE])
        self.assertEqual(image.xrefs(import_target, INDIRECT, 2, 6), [BASE + 16])
        self.assertEqual(image.literal_candidates(image.functions[0]),
                         [{"instruction_rva": hex(BASE), "literal": "DPAPI"}])
        self.assertEqual(image.import_candidates(image.functions[0]),
                         [{"instruction_rva": hex(BASE + 16), "import": "CryptUnprotectData"}])

    def test_function_lookup_rejects_gaps_and_exclusive_end_boundaries(self):
        image = synthetic_image(b"\x90" * 64)
        first, second = (BASE, BASE + 16), (BASE + 32, BASE + 48)
        image.functions = [first, second]
        image.starts = [first[0], second[0]]
        for address, expected in ((BASE - 1, None), (BASE, first), (BASE + 15, first),
                                  (BASE + 16, None), (BASE + 31, None), (BASE + 32, second),
                                  (BASE + 47, second), (BASE + 48, None)):
            with self.subTest(address=hex(address)):
                self.assertEqual(image.function_at(address), expected)

    def test_xrefs_never_complete_instruction_across_code_section_boundary(self):
        target = BASE + 5
        data = b"\xe8\x00\x00\x00\x00" + instruction(b"\xe8", BASE + 5, target)
        image = synthetic_image(data, code_size=4)
        self.assertEqual(image.xrefs(target, DIRECT, 1, 5), [])
        image.sections = [(BASE, 4, 0), (BASE + 0x100, 4, 6)]
        self.assertEqual(image.file_rva(6), BASE + 0x100)
        with self.assertRaisesRegex(ValueError, "FILE_RVA_UNMAPPED"):
            image.file_rva(5)

    def test_xref_count_limit_is_inclusive_and_fails_on_next_match(self):
        target = BASE + 100
        data = b"".join(instruction(b"\xe8", BASE + index * 5, target) for index in range(3))
        with patch.object(trace, "MAX_XREFS", 2):
            self.assertEqual(synthetic_image(data[:10]).xrefs(target, DIRECT, 1, 5), [BASE, BASE + 5])
            with self.assertRaisesRegex(ValueError, "XREF_COUNT_BOUND"):
                synthetic_image(data).xrefs(target, DIRECT, 1, 5)

    def test_both_function_scanners_reject_oversize_before_reading_bytes(self):
        image = synthetic_image(b"\x90")
        image.part = Mock(side_effect=AssertionError("oversize function bytes must not be read"))
        function = (BASE, BASE + trace.MAX_FUNCTION + 1)
        for scanner in (image.import_candidates, image.literal_candidates):
            with self.subTest(scanner=scanner.__name__):
                with self.assertRaisesRegex(ValueError, "FUNCTION_SIZE_BOUND"):
                    scanner(function)
        image.part.assert_not_called()

    def test_coincident_template_and_dpapi_candidates_never_become_verified(self):
        data = bytearray(b"\x90" * 256)
        literal_target, import_target = BASE + 128, BASE + 300
        data[:7] = instruction(b"\x48\x8d\x0d", BASE, literal_target)
        data[16:22] = instruction(b"\xff\x15", BASE + 16, import_target)
        data[128:128 + len(trace.LITERAL) + 1] = trace.LITERAL + b"\0"
        image = synthetic_image(data, code_size=64)
        image.functions = [(BASE, BASE + 64)]
        image.literal_targets = {literal_target: [trace.LITERAL.decode("ascii")]}
        image.import_slots = {import_target: "CryptUnprotectData"}
        with patch.object(trace, "read_installed", return_value=bytes(data)) as read, \
                patch.object(trace, "Image", return_value=image):
            report = trace.run()
        read.assert_called_once()
        self.assertEqual(report["status"], "STATIC_XREF_CANDIDATES")
        self.assertEqual(report["template_xref_count"], 1)
        self.assertEqual(report["dpapi_xref_count"], 1)
        self.assertEqual(len(report["candidate_functions"]), 1)
        self.assertEqual({row["kind"] for row in report["candidate_functions"][0]["references"]},
                         {"hexkey_template", "dpapi_import"})
        for field in ("instruction_boundaries_verified", "data_flow_verified", "live_key_recovery_verified",
                      "account_files_read", "process_memory_read", "viber_code_executed"):
            self.assertIs(report[field], False)
        self.assertNotIn("verified\":true", json.dumps(report, separators=(",", ":")))

    def test_run_rejects_absent_or_duplicate_template_without_installed_reads(self):
        for count in (0, 2):
            with self.subTest(count=count):
                data = b"synthetic" + (trace.LITERAL + b"\0") * count
                image = synthetic_image(data)
                with patch.object(trace, "read_installed", return_value=data), \
                        patch.object(trace, "Image", return_value=image):
                    with self.assertRaisesRegex(ValueError, "TEMPLATE_NOT_UNIQUE"):
                        trace.run()


if __name__ == "__main__":
    unittest.main()
