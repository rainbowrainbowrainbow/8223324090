"""Synthetic Qt-shaped doubles and public-output checks; no Qt/Viber access."""

from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
import unittest

from observe_g3 import ObserverError, QtRows, public_result, reference, valid_public


class FakeError:
    def __init__(self, native="", valid=False):
        self.native, self.valid = native, valid

    def nativeErrorCode(self):
        return self.native

    def isValid(self):
        return self.valid


class FakeQuery:
    def __init__(self, rows=(), *, prepare_ok=True, exec_ok=True,
                 native_error="", terminal_error="", raises_at=None):
        self.rows = list(rows)
        self.prepare_ok, self.exec_ok = prepare_ok, exec_ok
        self.native_error, self.terminal_error = native_error, terminal_error
        self.raises_at = raises_at
        self.position = -1
        self.error = FakeError()
        self.prepared = []
        self.bindings = []
        self.executions = []
        self.finish_count = 0
        self.value_reads = []

    def prepare(self, sql):
        self.prepared.append(sql)
        if self.raises_at == "prepare":
            raise RuntimeError("synthetic prepare failure")
        if not self.prepare_ok:
            self.error = FakeError(self.native_error, True)
        return self.prepare_ok

    def bindValue(self, name, value):
        if self.raises_at == "bind":
            raise RuntimeError("synthetic bind failure")
        self.bindings.append((name, value))

    def exec(self, *args):
        self.executions.append(args)
        if self.raises_at == "exec":
            raise RuntimeError("synthetic exec failure")
        if not self.exec_ok:
            self.error = FakeError(self.native_error, True)
        return self.exec_ok

    def next(self):
        if self.raises_at == "next":
            raise RuntimeError("synthetic fetch failure")
        self.position += 1
        if self.position < len(self.rows):
            return True
        if self.terminal_error:
            self.error = FakeError(self.terminal_error, True)
        return False

    def isNull(self, index):
        return self.rows[self.position][index] is None

    def value(self, index):
        if self.raises_at == "value":
            raise RuntimeError("synthetic conversion failure")
        self.value_reads.append((self.position, index))
        return self.rows[self.position][index]

    def lastError(self):
        return self.error

    def finish(self):
        self.finish_count += 1


class QtRowsTests(unittest.TestCase):
    def adapter(self, query):
        database = object()

        def create_query(received_database):
            self.assertIs(received_database, database)
            return query

        return QtRows(SimpleNamespace(sql=SimpleNamespace(QSqlQuery=create_query)), database)

    def expect_error(self, query, expected, *, row_limit=4):
        adapter = self.adapter(query)
        with self.assertRaises(ObserverError) as caught:
            adapter("SELECT :marker", {"marker": "synthetic-marker"}, 1, row_limit)
        self.assertEqual(caught.exception.code, expected)
        self.assertEqual(str(caught.exception), expected)
        self.assertEqual(query.finish_count, 1)

    def test_prepared_bindings_are_separate_from_sql_and_null_is_preserved(self):
        query = FakeQuery([(11, None)])
        sql = "SELECT :event_id, :marker"
        parameters = {"event_id": 11, "marker": "synthetic ' quoted value"}
        rows = self.adapter(query)(sql, parameters, 2, 2)
        self.assertEqual(rows, [(11, None)])
        self.assertEqual(query.prepared, [sql])
        self.assertEqual(query.bindings, [(":event_id", 11), (":marker", "synthetic ' quoted value")])
        self.assertEqual(query.executions, [()])
        self.assertEqual(query.value_reads, [(0, 0)])
        self.assertEqual(query.finish_count, 1)
        self.assertEqual(parameters["event_id"], 11)

    def test_terminal_fetch_failure_rejects_already_fetched_partial_rows(self):
        query = FakeQuery([(11,), (12,)], terminal_error="10")
        self.expect_error(query, "SOURCE_QUERY_FAILED")
        self.assertEqual(query.value_reads, [(0, 0), (1, 0)])

    def test_busy_and_locked_extended_codes_are_classified_at_exec_and_fetch(self):
        for code in ["5", "6", "261", "262", "517"]:
            for phase in ["exec", "fetch"]:
                with self.subTest(code=code, phase=phase):
                    query = (FakeQuery(exec_ok=False, native_error=code) if phase == "exec"
                             else FakeQuery([(11,)], terminal_error=code))
                    self.expect_error(query, "SOURCE_BUSY")

    def test_malformed_or_other_native_error_is_generic_and_redacted(self):
        for native in ["", "not a numeric code", "999999999999999999999", "1", "26"]:
            with self.subTest(native=native):
                self.expect_error(FakeQuery(exec_ok=False, native_error=native), "SOURCE_QUERY_FAILED")

    def test_prepare_failure_finishes_without_binding_or_execution(self):
        query = FakeQuery(prepare_ok=False, native_error="1")
        self.expect_error(query, "SOURCE_QUERY_FAILED")
        self.assertEqual(query.bindings, [])
        self.assertEqual(query.executions, [])

    def test_exact_row_cap_is_allowed_but_one_extra_row_rejects_everything(self):
        exact = FakeQuery([(11,), (12,)])
        self.assertEqual(self.adapter(exact)("SELECT fixed", {}, 1, 2), [(11,), (12,)])
        self.assertEqual(exact.finish_count, 1)
        overflow = FakeQuery([(11,), (12,), (13,)])
        self.expect_error(overflow, "WINDOW_OVERFLOW", row_limit=2)
        self.assertEqual(overflow.value_reads, [(0, 0), (1, 0)])

    def test_terminal_failure_at_exact_row_cap_is_not_mistaken_for_success(self):
        self.expect_error(FakeQuery([(11,), (12,)], terminal_error="5"), "SOURCE_BUSY", row_limit=2)

    def test_empty_success_still_finishes_query(self):
        query = FakeQuery()
        self.assertEqual(self.adapter(query)("SELECT fixed", {}, 1, 2), [])
        self.assertEqual(query.finish_count, 1)

    def test_python_side_failures_in_every_query_phase_still_finish(self):
        for phase in ["prepare", "bind", "exec", "next", "value"]:
            with self.subTest(phase=phase):
                query = FakeQuery([(11,)], raises_at=phase)
                with self.assertRaises(Exception):
                    self.adapter(query)("SELECT :marker", {"marker": "synthetic-marker"}, 1, 2)
                self.assertEqual(query.finish_count, 1)


class PublicOutputTests(unittest.TestCase):
    def test_default_public_result_is_valid(self):
        self.assertTrue(valid_public(public_result()))

    def test_non_dict_values_are_rejected_without_exception(self):
        for value in [None, [], "synthetic-private-value", 7, True]:
            with self.subTest(kind=type(value).__name__):
                self.assertFalse(valid_public(value))

    def test_wrong_types_for_every_public_field_are_rejected(self):
        original = public_result()
        for field, default in original.items():
            with self.subTest(field=field):
                changed = deepcopy(original)
                changed[field] = (True if type(default) is int else
                                  1 if type(default) is bool else [])
                self.assertFalse(valid_public(changed))

    def test_unhashable_status_and_error_are_rejected_without_exception(self):
        for field in ["status", "error_code"]:
            for value in [[], {}, {"synthetic"}]:
                with self.subTest(field=field, kind=type(value).__name__):
                    self.assertFalse(valid_public(dict(public_result(), **{field: value})))

    def test_unknown_protocol_version_is_rejected(self):
        for version in [0, 2, -1, "1", True]:
            with self.subTest(version=version):
                self.assertFalse(valid_public(dict(public_result(), report_version=version)))

    def test_forbidden_extra_fields_are_rejected(self):
        for field in ["key", "message_body", "phone", "contact_id", "query", "source_event_id"]:
            with self.subTest(field=field):
                self.assertFalse(valid_public(dict(public_result(), **{field: "synthetic-private-value"})))

    def test_export_send_and_unverified_capability_claims_are_rejected(self):
        for field in ["direction_semantics_verified", "new_contact_globally_verified", "recipient_verified",
                      "provider_delivery_verified", "private_text_exported", "keys_exported", "crm_contacted"]:
            with self.subTest(field=field):
                self.assertFalse(valid_public(dict(public_result(), **{field: True})))
        self.assertFalse(valid_public(dict(public_result(), messages_sent=1)))

    def test_nested_case_counts_reject_extra_fields_wrong_types_and_overflow(self):
        for counts in [{}, {"private": "synthetic-private-value"},
                       dict(public_result()["case_counts"], DUP=True),
                       dict(public_result()["case_counts"], DUP=-1),
                       dict(public_result()["case_counts"], DUP=1001)]:
            with self.subTest(counts=counts):
                self.assertFalse(valid_public(dict(public_result(), case_counts=counts)))

    def test_observed_status_requires_runtime_proofs_and_nonempty_journal(self):
        result = dict(public_result(), status="TEST_MARKERS_OBSERVED", journal_total=1)
        self.assertFalse(valid_public(result))
        for field in ["synthetic_fixture_passed", "target_verified", "local_database_readable", "source_file_continuity_verified"]:
            result[field] = True
        self.assertTrue(valid_public(result))
        self.assertFalse(valid_public(dict(result, journal_total=0)))

    def test_run_id_and_error_cannot_carry_free_form_text(self):
        self.assertFalse(valid_public(dict(public_result(), run_id="synthetic-private-value")))
        self.assertFalse(valid_public(dict(public_result(), error_code="synthetic-private-value")))


class ReferenceTests(unittest.TestCase):
    def test_namespace_value_and_secret_separate_references(self):
        secret = b"synthetic-hmac-key-for-tests-only"
        namespaces = ["chat", "source-contact", "database-epoch", "local-account-directory"]
        refs = [reference(secret, namespace, 11) for namespace in namespaces]
        self.assertEqual(len(set(refs)), len(namespaces))
        self.assertEqual(refs[0], reference(secret, "chat", 11))
        self.assertNotEqual(refs[0], reference(secret, "chat", 12))
        self.assertNotEqual(refs[0], reference(b"other-synthetic-key", "chat", 11))
        for value in refs:
            self.assertRegex(value, r"\Ahmac:[0-9a-f]{64}\Z")


if __name__ == "__main__":
    unittest.main()
