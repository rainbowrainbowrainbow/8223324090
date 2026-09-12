"""Synthetic in-memory SQLite checks; never imports Qt or accesses Viber."""

from __future__ import annotations

import json
import sqlite3
import unittest

from g3_queries import MARKER_SQL, MAX_ID_SQL, WINDOW_SQL, QueryError, scan_window


DUP = "EGXG3-A1B2C3D4-DUP"
NEW = "EGXG3-A1B2C3D4-NEW"
PHONE = "EGXG3-A1B2C3D4-PHONE"


class QueryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        # Deliberately omit unique constraints so fan-out defenses are tested.
        self.db.executescript("""
            CREATE TABLE Events(EventID, ChatID, ContactID, TimeStamp, Direction);
            CREATE TABLE Messages(EventID, Body TEXT COLLATE NOCASE);
            CREATE TABLE Contact(ContactID, Number);
            CREATE TABLE ChatInfo(ChatID, Token);
        """)
        self.calls = []

    def tearDown(self):
        self.db.close()

    def read(self, sql, params, column_count, row_limit):
        self.calls.append((sql, dict(params), column_count, row_limit))
        cursor = self.db.execute(sql, params)
        self.assertEqual(len(cursor.description), column_count)
        rows = cursor.fetchmany(row_limit + 1)
        self.assertLessEqual(len(rows), row_limit)
        return rows

    def relation(self, chat=20, contact=30, number="synthetic-private-number", token="synthetic-private-token"):
        self.db.execute("INSERT INTO Contact VALUES (?, ?)", (contact, number))
        self.db.execute("INSERT INTO ChatInfo VALUES (?, ?)", (chat, token))

    def event(self, event_id, body=DUP, chat=20, contact=30, direction=0):
        self.db.execute("INSERT INTO Events VALUES (?, ?, ?, ?, ?)",
                        (event_id, chat, contact, 1700000000000, direction))
        if body is not None:
            self.db.execute("INSERT INTO Messages VALUES (?, ?)", (event_id, body))

    def expect_error(self, code, action):
        with self.assertRaises(QueryError) as caught:
            action()
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(str(caught.exception), code)

    def test_two_identical_markers_are_two_event_occurrences(self):
        self.relation()
        self.event(11)
        self.event(12)
        result = scan_window(self.read, 10, [DUP])
        self.assertEqual(result["window_count"], 2)
        self.assertEqual([r["source_event_id"] for r in result["observations"]], [11, 12])
        self.assertEqual([r["marker"] for r in result["observations"]], [DUP, DUP])

    def test_exact_binary_match_excludes_private_body_and_case_changes(self):
        self.relation()
        for event_id, body in enumerate([DUP.lower(), "prefix " + DUP, DUP + "\n", "synthetic-private-body", DUP], 11):
            self.event(event_id, body=body)
        result = scan_window(self.read, 10, [DUP])
        self.assertEqual([r["source_event_id"] for r in result["observations"]], [15])
        serialized = json.dumps(result)
        for private in ["synthetic-private-body", "synthetic-private-number", "synthetic-private-token"]:
            self.assertNotIn(private, serialized)
        self.assertEqual(set(result["observations"][0]), {
            "source_event_id", "chat_id", "contact_id", "marker", "direction_code",
            "number_present", "token_present", "chat_had_events_before_baseline",
        })

    def test_unknown_contact_is_discovered_after_relation_hydration(self):
        self.event(11, body=NEW, chat=101, contact=202)
        first = scan_window(self.read, 10, [NEW])
        self.assertEqual(first["pending_relations"], 1)
        self.assertEqual(first["observations"], [])
        self.relation(chat=101, contact=202)
        second = scan_window(self.read, 10, [NEW])
        self.assertEqual(second["pending_relations"], 0)
        self.assertEqual(second["observations"][0]["contact_id"], 202)
        self.assertFalse(second["observations"][0]["chat_had_events_before_baseline"])

    def test_late_message_below_previous_cursor_is_found_with_same_baseline(self):
        self.relation()
        self.event(11, body=None)
        self.event(12, body="unrelated synthetic text")
        first = scan_window(self.read, 10, [DUP])
        self.assertEqual(first["cursor"], 12)
        self.assertEqual(first["observations"], [])
        self.db.execute("INSERT INTO Messages VALUES (?, ?)", (11, DUP))
        second = scan_window(self.read, 10, [DUP])
        self.assertEqual(second["cursor"], 12)
        self.assertEqual(second["observations"][0]["source_event_id"], 11)

    def test_repeat_scan_keeps_same_source_ids_and_known_chat_flag(self):
        self.relation()
        self.event(9, body="older synthetic text")
        self.event(11)
        first = scan_window(self.read, 10, [DUP])
        self.assertEqual(first, scan_window(self.read, 10, [DUP]))
        self.assertTrue(first["observations"][0]["chat_had_events_before_baseline"])

    def test_duplicate_message_rows_fail_closed(self):
        self.relation()
        self.event(11)
        self.db.execute("INSERT INTO Messages VALUES (?, ?)", (11, DUP))
        self.expect_error("CARDINALITY_AMBIGUOUS", lambda: scan_window(self.read, 10, [DUP]))

    def test_different_message_rows_sharing_event_also_fail_closed(self):
        self.relation()
        self.event(11)
        self.db.execute("INSERT INTO Messages VALUES (?, ?)", (11, "other synthetic part"))
        self.expect_error("CARDINALITY_AMBIGUOUS", lambda: scan_window(self.read, 10, [DUP]))

    def test_contact_and_chat_fanout_are_rejected(self):
        self.relation()
        self.event(11)
        for table, sql, values in [
            ("Contact", "INSERT INTO Contact VALUES (?, ?)", (30, "another synthetic number")),
            ("ChatInfo", "INSERT INTO ChatInfo VALUES (?, ?)", (20, "another synthetic token")),
        ]:
            with self.subTest(table=table):
                self.db.execute("SAVEPOINT duplicate_relation")
                self.db.execute(sql, values)
                self.expect_error("CARDINALITY_AMBIGUOUS", lambda: scan_window(self.read, 10, [DUP]))
                self.db.execute("ROLLBACK TO duplicate_relation")
                self.db.execute("RELEASE duplicate_relation")

    def test_duplicate_event_ids_are_rejected_before_marker_queries(self):
        self.event(11)
        self.event(11, body=None)
        self.expect_error("CARDINALITY_AMBIGUOUS", lambda: scan_window(self.read, 10, [DUP]))
        self.assertTrue(all(sql != MARKER_SQL for sql, *_ in self.calls))

    def test_window_overflow_includes_nonmarker_events_and_stops_early(self):
        for event_id in [11, 12, 13]:
            self.event(event_id, body="unrelated synthetic text")
        self.expect_error("WINDOW_OVERFLOW", lambda: scan_window(self.read, 10, [DUP], max_events=2))
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[1][3], 3)

    def test_cursor_regression_and_empty_database(self):
        self.expect_error("SOURCE_REGRESSED", lambda: scan_window(self.read, 10, [DUP]))
        result = scan_window(self.read, 0, [DUP])
        self.assertEqual(result, {"cursor": 0, "window_count": 0, "observations": [], "pending_relations": 0})
        self.event(9)
        self.expect_error("SOURCE_REGRESSED", lambda: scan_window(self.read, 10, [DUP]))

    def test_raw_direction_codes_never_infer_semantics(self):
        self.relation()
        for index, direction in enumerate([0, 1, 2, 3, 4, -1, "1", None], 11):
            self.event(index, direction=direction)
        result = scan_window(self.read, 10, [DUP])
        self.assertEqual([r["direction_code"] for r in result["observations"]], [0, 1, 2, 3, None, None, None, None])

    def test_empty_number_token_are_flags_not_missing_relations(self):
        self.relation(number="", token=None)
        self.event(11)
        result = scan_window(self.read, 10, [DUP])
        self.assertEqual(result["pending_relations"], 0)
        self.assertFalse(result["observations"][0]["number_present"])
        self.assertFalse(result["observations"][0]["token_present"])

    def test_null_foreign_ids_remain_pending_and_hydrate(self):
        self.event(11, chat=None, contact=None)
        self.assertEqual(scan_window(self.read, 10, [DUP])["pending_relations"], 1)
        self.relation()
        self.db.execute("UPDATE Events SET ChatID=20, ContactID=30 WHERE EventID=11")
        self.assertEqual(len(scan_window(self.read, 10, [DUP])["observations"]), 1)

    def test_nonpositive_foreign_id_is_not_silently_accepted(self):
        self.event(11, chat=-20)
        self.expect_error("SOURCE_VALUE_UNSUPPORTED", lambda: scan_window(self.read, 10, [DUP]))

    def test_parameters_never_interpolated_and_multiple_markers_sorted(self):
        self.relation()
        self.event(11, body=PHONE)
        self.event(12, body=NEW)
        result = scan_window(self.read, 10, [NEW, PHONE])
        self.assertEqual([r["source_event_id"] for r in result["observations"]], [11, 12])
        for sql, params, *_ in self.calls:
            self.assertNotIn(NEW, sql)
            self.assertNotIn(PHONE, sql)
            if sql == MARKER_SQL:
                self.assertIn(params["marker"], [NEW, PHONE])

    def test_invalid_input_and_marker_injection_never_query_source(self):
        for baseline, markers, maximum in [
            (-1, [DUP], 2), (True, [DUP], 2), (0, [DUP], 0), (0, [DUP], 2001),
            (0, [], 2), (0, [DUP, DUP], 2), (0, ["private message"], 2),
            (0, [DUP + "' OR 1=1 --"], 2),
        ]:
            with self.subTest(baseline=baseline, maximum=maximum):
                self.expect_error("SOURCE_VALUE_UNSUPPORTED", lambda: scan_window(self.read, baseline, markers, maximum))
        self.assertEqual(self.calls, [])

    def test_inconsistent_window_or_observation_is_source_regression(self):
        def inconsistent(sql, params, columns, limit):
            if sql == MAX_ID_SQL:
                return [(12,)]
            if sql == WINDOW_SQL:
                return [(11,)]
            self.fail("marker query must not run")
        self.expect_error("SOURCE_REGRESSED", lambda: scan_window(inconsistent, 10, [DUP]))

    def test_hard_limit_2001st_window_event_is_detected(self):
        self.db.executemany("INSERT INTO Events VALUES (?, 20, 30, 0, 0)", [(x,) for x in range(1, 2002)])
        self.expect_error("WINDOW_OVERFLOW", lambda: scan_window(self.read, 0, [DUP]))


if __name__ == "__main__":
    unittest.main()
