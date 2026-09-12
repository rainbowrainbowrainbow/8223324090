"""Paired-only query tests; synthetic rows, no Viber or private text."""

import unittest

import p1_paired_queries as paired


PHONE = "EGXG3-0B038E78-PHONE"
DESKTOP = "EGXG3-0B038E78-DESKTOP"


class Reader:
    def __init__(self, phone=None, desktop=None, inbound=None, reconcile=None, latest=None,
                 seeded=None, seeded_reply=None):
        self.phone = [(10, 20, 30, 0)] if phone is None else phone
        self.desktop = [(11, 20, 40, 1)] if desktop is None else desktop
        self.inbound = [] if inbound is None else inbound
        self.reconcile = [] if reconcile is None else reconcile
        self.latest = [] if latest is None else latest
        self.seeded = [] if seeded is None else seeded
        self.seeded_reply = [] if seeded_reply is None else seeded_reply

    def __call__(self, sql, params, _columns, _limit):
        if sql == paired.ANCHOR_SQL:
            return self.phone if params["marker"].endswith("-PHONE") else self.desktop
        if sql == paired.RECONCILE_SQL:
            return self.reconcile
        if sql == paired.LATEST_INBOUND_SQL:
            return self.latest
        if sql == paired.SEEDED_OUTBOUND_SQL:
            return self.seeded
        if sql == paired.SEEDED_REPLY_SQL:
            return self.seeded_reply
        return self.inbound


class PairedQueriesTests(unittest.TestCase):
    def test_anchor_proves_same_chat_distinct_direction(self):
        anchor = paired.resolve_anchor(Reader(), PHONE, DESKTOP)
        self.assertEqual(anchor, {"chat_id": 20, "peer_contact_id": 30, "inbound_code": 0,
                                  "outbound_code": 1, "anchor_event_id": 11})

    def test_anchor_rejects_duplicates_chat_mismatch_and_equal_direction(self):
        cases = [
            Reader(phone=[]),
            Reader(phone=[(10, 20, 30, 0), (12, 20, 30, 0)]),
            Reader(desktop=[(11, 21, 40, 1)]),
            Reader(desktop=[(11, 20, 40, 0)]),
        ]
        for reader in cases:
            with self.subTest(reader=reader), self.assertRaises(paired.PairedQueryError):
                paired.resolve_anchor(reader, PHONE, DESKTOP)

    def test_inbound_preserves_identical_occurrences_and_order(self):
        reader = Reader(inbound=[(12, 20, 30, 0, "same"), (13, 20, 30, 0, "same")])
        anchor = paired.resolve_anchor(reader, PHONE, DESKTOP)
        self.assertEqual(paired.scan_inbound(reader, anchor, 11), [
            {"source_event_id": 12, "text": "same"},
            {"source_event_id": 13, "text": "same"},
        ])

    def test_wrong_peer_or_unsupported_text_fails_entire_batch(self):
        for rows in ([(12, 20, 31, 0, "text")], [(12, 20, 30, 0, "")],
                     [(12, 20, 30, 0, "x" * (paired.MAX_TEXT + 1))]):
            with self.subTest(rows=rows), self.assertRaises(paired.PairedQueryError):
                reader = Reader(inbound=rows)
                paired.scan_inbound(reader, paired.resolve_anchor(reader, PHONE, DESKTOP), 11)

    def test_cursor_and_overflow_fail_closed(self):
        reader = Reader(inbound=[(index, 20, 30, 0, "x") for index in range(12, 15)])
        anchor = paired.resolve_anchor(reader, PHONE, DESKTOP)
        with self.assertRaises(paired.PairedQueryError):
            paired.scan_inbound(reader, anchor, 10)
        with self.assertRaises(paired.PairedQueryError) as caught:
            paired.scan_inbound(reader, anchor, 11, limit=2)
        self.assertEqual(caught.exception.code, "BATCH_OVERFLOW")

    def test_reconcile_requires_one_outbound_occurrence_in_anchor_chat(self):
        text = "EGXP1-0B038E78-A1B2C3D4-SEND"
        reader = Reader(reconcile=[(15, 20, 1)])
        anchor = paired.resolve_anchor(reader, PHONE, DESKTOP)
        self.assertEqual(paired.reconcile_outbound(reader, anchor, text, 14),
                         {"observed": True, "source_event_id": 15})
        self.assertEqual(paired.reconcile_outbound(Reader(), anchor, text, 14), {"observed": False})
        for rows in ([(15, 21, 1)], [(15, 20, 0)], [(15, 20, 1), (16, 20, 1)]):
            with self.subTest(rows=rows), self.assertRaises(paired.PairedQueryError):
                paired.reconcile_outbound(Reader(reconcile=rows), anchor, text, 14)

    def test_reconcile_rejects_old_matching_text_before_command_baseline(self):
        text = "repeat"
        reader = Reader(reconcile=[])
        anchor = paired.resolve_anchor(reader, PHONE, DESKTOP)
        self.assertEqual(paired.reconcile_outbound(Reader(reconcile=[(20, 20, 1)]), anchor, text, 19),
                         {"observed": True, "source_event_id": 20})
        self.assertEqual(paired.reconcile_outbound(Reader(), anchor, text, 20), {"observed": False})
        with self.assertRaises(paired.PairedQueryError) as caught:
            paired.reconcile_outbound(Reader(reconcile=[(20, 20, 1)]), anchor, text, 10)
        self.assertEqual(caught.exception.code, "RECONCILE_BASELINE_BEFORE_ANCHOR")


    def test_reconcile_allows_multiline_text(self):
        text = "Перший рядок\nДругий рядок"
        reader = Reader(reconcile=[(15, 20, 1)])
        anchor = paired.resolve_anchor(reader, PHONE, DESKTOP)
        self.assertEqual(paired.reconcile_outbound(reader, anchor, text, 14),
                         {"observed": True, "source_event_id": 15})

    def test_latest_inbound_requires_anchor_peer_and_does_not_transform_text(self):
        reader = Reader(latest=[(9, 20, 30, 0, "Привіт")])
        anchor = paired.resolve_anchor(reader, PHONE, DESKTOP)
        self.assertEqual(paired.latest_inbound(reader, anchor), "Привіт")
        self.assertIsNone(paired.latest_inbound(Reader(), anchor))
        with self.assertRaises(paired.PairedQueryError):
            paired.latest_inbound(Reader(latest=[(9, 20, 31, 0, "wrong peer")]), anchor)

    def test_latest_seeded_reply_uses_unique_outbound_chat_and_proven_directions(self):
        reader = Reader(seeded=[(15, 50, 1)], seeded_reply=[(16, 50, 60, 0, "Synthetic reply")])
        anchor = paired.resolve_anchor(reader, PHONE, DESKTOP)
        self.assertEqual(paired.latest_seeded_reply(reader, anchor, "sent text"), "Synthetic reply")
        self.assertIsNone(paired.latest_seeded_reply(
            Reader(seeded=[(15, 50, 1)]), anchor, "sent text"))

    def test_latest_seeded_reply_fails_closed_on_ambiguous_or_wrong_identity(self):
        anchor = paired.resolve_anchor(Reader(), PHONE, DESKTOP)
        cases = [
            Reader(seeded=[]),
            Reader(seeded=[(15, 50, 1), (17, 50, 1)]),
            Reader(seeded=[(15, 50, 0)]),
            Reader(seeded=[(15, 50, 1)], seeded_reply=[(16, 51, 60, 0, "wrong")]),
            Reader(seeded=[(15, 50, 1)], seeded_reply=[(16, 50, 60, 1, "wrong")]),
        ]
        for reader in cases:
            with self.subTest(reader=reader), self.assertRaises(paired.PairedQueryError):
                paired.latest_seeded_reply(reader, anchor, "sent text")


if __name__ == "__main__":
    unittest.main()
