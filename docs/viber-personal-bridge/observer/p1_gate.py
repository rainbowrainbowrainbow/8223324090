"""Evidence gate for enabling a bounded Viber Personal Bridge test send.

The gate accepts only redacted facts. Synthetic evidence can exercise code but
cannot promote live capabilities.
"""

from __future__ import annotations

from typing import Any, Mapping


class GateError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


_STATUS = {"pass", "fail", "not_run"}
_EVIDENCE = {"none", "synthetic", "live_readonly", "live_send", "peer_confirmed"}
_LIVE = {"live_readonly", "live_send", "peer_confirmed"}


def _check_fact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise GateError(code)
    result = dict(value)
    if result["status"] not in _STATUS or result["evidence"] not in _EVIDENCE:
        raise GateError(code)
    if result["status"] == "not_run" and result["evidence"] != "none":
        raise GateError(code)
    return result


def evaluate(evidence: Mapping[str, Any]) -> dict[str, Any]:
    required = {"protocol_version", "account", "new_contact", "direction",
                "duplicates", "reader_restart", "peer_checks"}
    if not isinstance(evidence, Mapping) or set(evidence) != required:
        raise GateError("GATE_SHAPE_INVALID")
    if evidence["protocol_version"] != "1.0":
        raise GateError("PROTOCOL_UNSUPPORTED")

    account = _check_fact(evidence["account"],
                          {"status", "evidence", "profile_bound_to_source"},
                          "ACCOUNT_EVIDENCE_INVALID")
    new_contact = _check_fact(evidence["new_contact"],
                              {"status", "evidence", "unpaired", "distinct_chat"},
                              "NEW_CONTACT_EVIDENCE_INVALID")
    direction = _check_fact(evidence["direction"],
                            {"status", "evidence", "inbound_code", "outbound_code"},
                            "DIRECTION_EVIDENCE_INVALID")
    duplicates = _check_fact(evidence["duplicates"],
                             {"status", "evidence", "distinct_occurrences"},
                             "DUPLICATE_EVIDENCE_INVALID")
    restart = _check_fact(evidence["reader_restart"],
                          {"status", "evidence", "baseline_reused", "duplicate_created"},
                          "RESTART_EVIDENCE_INVALID")
    checks = evidence["peer_checks"]
    if not isinstance(checks, list) or len(checks) > 100:
        raise GateError("PEER_CHECKS_INVALID")

    for fact, bool_fields in [
        (account, ("profile_bound_to_source",)),
        (new_contact, ("unpaired", "distinct_chat")),
        (restart, ("baseline_reused", "duplicate_created")),
    ]:
        if any(type(fact[field]) is not bool for field in bool_fields):
            raise GateError("GATE_VALUE_INVALID")
    if (direction["inbound_code"] is not None and type(direction["inbound_code"]) is not int
            or direction["outbound_code"] is not None and type(direction["outbound_code"]) is not int):
        raise GateError("DIRECTION_EVIDENCE_INVALID")
    if type(duplicates["distinct_occurrences"]) is not int or duplicates["distinct_occurrences"] < 0:
        raise GateError("DUPLICATE_EVIDENCE_INVALID")

    normalized_checks = []
    for item in checks:
        fields = {"peer_alias", "evidence", "matched", "ambiguous", "renamed", "reordered"}
        if not isinstance(item, Mapping) or set(item) != fields:
            raise GateError("PEER_CHECK_INVALID")
        row = dict(item)
        if row["peer_alias"] not in {"B", "C"} or row["evidence"] not in _EVIDENCE:
            raise GateError("PEER_CHECK_INVALID")
        if any(type(row[field]) is not bool for field in ("matched", "ambiguous", "renamed", "reordered")):
            raise GateError("PEER_CHECK_INVALID")
        normalized_checks.append(row)

    wrong_recipient = any(not row["matched"] and not row["ambiguous"] for row in normalized_checks)
    account_ok = (account["status"] == "pass" and account["evidence"] in _LIVE
                  and account["profile_bound_to_source"])
    new_ok = (new_contact["status"] == "pass" and new_contact["evidence"] in _LIVE
              and new_contact["unpaired"] and new_contact["distinct_chat"])
    direction_ok = (direction["status"] == "pass" and direction["evidence"] in _LIVE
                    and type(direction["inbound_code"]) is int
                    and type(direction["outbound_code"]) is int
                    and direction["inbound_code"] != direction["outbound_code"])
    duplicates_ok = (duplicates["status"] == "pass" and duplicates["evidence"] in _LIVE
                     and duplicates["distinct_occurrences"] >= 2)
    restart_ok = (restart["status"] == "pass" and restart["evidence"] in _LIVE
                  and restart["baseline_reused"] and not restart["duplicate_created"])

    live_checks = [row for row in normalized_checks if row["evidence"] in _LIVE]
    alternating = all(live_checks[index]["peer_alias"] != live_checks[index - 1]["peer_alias"]
                      for index in range(1, len(live_checks)))
    aliases = {row["peer_alias"] for row in live_checks}
    peer_ok = (len(live_checks) >= 30 and aliases == {"B", "C"} and alternating
               and all(row["matched"] and not row["ambiguous"] for row in live_checks)
               and any(row["renamed"] for row in live_checks)
               and any(row["reordered"] for row in live_checks))

    blockers = []
    for ok, code in [
        (account_ok, "ACCOUNT_IDENTITY_NOT_PROVEN"),
        (new_ok, "NEW_CONTACT_NOT_PROVEN"),
        (direction_ok, "DIRECTION_NOT_PROVEN"),
        (duplicates_ok, "DUPLICATE_OCCURRENCE_NOT_PROVEN"),
        (restart_ok, "READER_RESTART_NOT_PROVEN"),
        (peer_ok, "EXACT_PEER_NOT_PROVEN"),
    ]:
        if not ok:
            blockers.append(code)
    if wrong_recipient:
        blockers.insert(0, "WRONG_RECIPIENT_OBSERVED")

    if wrong_recipient or any(fact["status"] == "fail" for fact in
                              (account, new_contact, direction, duplicates, restart)):
        verdict = "NO_GO"
    elif not blockers:
        verdict = "GO_TEST_SEND"
    else:
        verdict = "LIMITED"
    return {
        "protocol_version": "1.0",
        "verdict": verdict,
        "send_test_allowed": verdict == "GO_TEST_SEND",
        "production_send_allowed": False,
        "checks": {
            "account_identity": account_ok,
            "new_contact": new_ok,
            "direction": direction_ok,
            "duplicate_occurrence": duplicates_ok,
            "reader_restart": restart_ok,
            "exact_peer": peer_ok,
        },
        "peer_check_count": len(live_checks),
        "blockers": blockers,
    }


def from_g3_public(result: Mapping[str, Any]) -> dict[str, Any]:
    """Convert existing redacted G3 output without promoting unproven claims."""
    if not isinstance(result, Mapping):
        raise GateError("G3_RESULT_INVALID")
    if set(result) == {"bootstrap", "result"}:
        if result["bootstrap"] != "windows_sid" or not isinstance(result["result"], Mapping):
            raise GateError("G3_RESULT_INVALID")
        result = result["result"]
    runtime_proven = (
        result.get("status") == "TEST_MARKERS_OBSERVED"
        and result.get("target_verified") is True
        and result.get("local_database_readable") is True
        and result.get("source_file_continuity_verified") is True
        and result.get("private_text_exported") is False
        and result.get("keys_exported") is False
        and result.get("crm_contacted") is False
        and result.get("messages_sent") == 0
    )
    duplicates = runtime_proven and result.get("same_chat_distinct_duplicate_events") is True
    duplicate_count = 0
    case_counts = result.get("case_counts")
    if isinstance(case_counts, Mapping) and type(case_counts.get("DUP")) is int:
        duplicate_count = case_counts["DUP"]
    restart_ok = runtime_proven and result.get("baseline_reused") is True and result.get("newly_journaled") == 0
    return {
        "protocol_version": "1.0",
        "account": {"status": "not_run", "evidence": "none",
                    "profile_bound_to_source": False},
        "new_contact": {"status": "not_run", "evidence": "none",
                        "unpaired": False, "distinct_chat": False},
        "direction": {"status": "not_run", "evidence": "none",
                      "inbound_code": None, "outbound_code": None},
        "duplicates": {"status": "pass" if duplicates else "not_run",
                       "evidence": "live_readonly" if duplicates else "none",
                       "distinct_occurrences": duplicate_count},
        "reader_restart": {"status": "pass" if restart_ok else "not_run",
                           "evidence": "live_readonly" if restart_ok else "none",
                           "baseline_reused": restart_ok, "duplicate_created": False},
        "peer_checks": [],
    }
