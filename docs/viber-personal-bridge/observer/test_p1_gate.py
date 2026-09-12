"""P1 evidence gate tests."""

import json
from pathlib import Path
import unittest

from p1_gate import GateError, evaluate, from_g3_public


def evidence(level="live_readonly"):
    checks = []
    for index in range(30):
        checks.append({
            "peer_alias": "B" if index % 2 == 0 else "C",
            "evidence": level,
            "matched": True,
            "ambiguous": False,
            "renamed": index == 10,
            "reordered": index == 20,
        })
    return {
        "protocol_version": "1.0",
        "account": {"status": "pass", "evidence": level,
                    "profile_bound_to_source": True},
        "new_contact": {"status": "pass", "evidence": level,
                        "unpaired": True, "distinct_chat": True},
        "direction": {"status": "pass", "evidence": level,
                      "inbound_code": 0, "outbound_code": 1},
        "duplicates": {"status": "pass", "evidence": level,
                       "distinct_occurrences": 2},
        "reader_restart": {"status": "pass", "evidence": level,
                           "baseline_reused": True, "duplicate_created": False},
        "peer_checks": checks,
    }


class GateTests(unittest.TestCase):
    def test_complete_live_identity_evidence_allows_only_bounded_test_send(self):
        result = evaluate(evidence())
        self.assertEqual(result["verdict"], "GO_TEST_SEND")
        self.assertTrue(result["send_test_allowed"])
        self.assertFalse(result["production_send_allowed"])
        self.assertEqual(result["blockers"], [])

    def test_synthetic_evidence_cannot_enable_live_capability(self):
        result = evaluate(evidence("synthetic"))
        self.assertEqual(result["verdict"], "LIMITED")
        self.assertFalse(result["send_test_allowed"])
        self.assertEqual(len(result["blockers"]), 6)

    def test_one_wrong_recipient_is_no_go(self):
        value = evidence()
        value["peer_checks"][17]["matched"] = False
        result = evaluate(value)
        self.assertEqual(result["verdict"], "NO_GO")
        self.assertEqual(result["blockers"][0], "WRONG_RECIPIENT_OBSERVED")

    def test_ambiguous_non_alternating_or_missing_rename_stays_limited(self):
        for mutate in [
            lambda value: value["peer_checks"][5].update(ambiguous=True),
            lambda value: value["peer_checks"][5].update(peer_alias="B"),
            lambda value: [row.update(renamed=False) for row in value["peer_checks"]],
        ]:
            value = evidence()
            mutate(value)
            with self.subTest(value=value):
                result = evaluate(value)
                self.assertEqual(result["verdict"], "LIMITED")
                self.assertIn("EXACT_PEER_NOT_PROVEN", result["blockers"])

    def test_existing_redacted_g3_proof_only_closes_duplicate_and_restart(self):
        path = Path(__file__).parent / "G3_SID_REOPEN_RESULT.json"
        public = json.loads(path.read_text(encoding="utf-8"))
        result = evaluate(from_g3_public(public))
        self.assertEqual(result["verdict"], "LIMITED")
        self.assertTrue(result["checks"]["duplicate_occurrence"])
        self.assertTrue(result["checks"]["reader_restart"])
        self.assertFalse(result["send_test_allowed"])
        self.assertIn("ACCOUNT_IDENTITY_NOT_PROVEN", result["blockers"])
        self.assertIn("EXACT_PEER_NOT_PROVEN", result["blockers"])

    def test_claimed_g3_flags_without_runtime_proof_do_not_close_gate(self):
        claimed = {
            "same_chat_distinct_duplicate_events": True,
            "case_counts": {"DUP": 2},
            "baseline_reused": True,
            "newly_journaled": 0,
        }
        result = evaluate(from_g3_public(claimed))
        self.assertFalse(result["checks"]["duplicate_occurrence"])
        self.assertFalse(result["checks"]["reader_restart"])

    def test_free_form_or_malformed_evidence_is_rejected(self):
        value = evidence()
        value["account"]["phone"] = "+00000000000"
        with self.assertRaises(GateError):
            evaluate(value)
        value = evidence()
        value["peer_checks"][0]["peer_alias"] = "Real Name"
        with self.assertRaises(GateError):
            evaluate(value)


if __name__ == "__main__":
    unittest.main()
