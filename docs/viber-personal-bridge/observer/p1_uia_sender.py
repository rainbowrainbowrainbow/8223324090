"""Real UI sender adapter for one verified Viber Personal Bridge chat.

The adapter delegates desktop interaction to the bounded PowerShell probes that
ship with the runtime. It never exports private message text in diagnostics and
only returns provider-neutral command outcomes to the dispatcher.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from typing import Any, Callable, Mapping, Sequence

from p1_live_inbound import G3SidReadOnlySource, max_event_id, peer_ref, source_chat_ref
from p1_paired_queries import resolve_anchor


_RUN_ID = re.compile(r"^[0-9A-F]{8}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_REF = re.compile(r"^(?:hmac:)?[0-9a-f]{64}$")


class UiaSenderError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class PowerShellViberSender:
    """UI adapter that sends text through the currently opened Viber Desktop chat."""

    def __init__(self, *, state_path: str | Path, run_id: str,
                 runtime_dir: str | Path | None = None,
                 runner: Callable[[Sequence[str], int], Mapping[str, Any]] | None = None,
                 powershell: str | None = None, python_exe: str | None = None,
                 reference_key: bytes | None = None,
                 anchor_probe: Callable[[], Mapping[str, Any]] | None = None):
        self.state_path = Path(state_path)
        self.runtime_dir = Path(runtime_dir) if runtime_dir is not None else Path(__file__).resolve().parent
        self.run_id = _run_id(run_id)
        self.powershell = powershell or "powershell.exe"
        self.python_exe = python_exe or sys.executable
        self._runner = runner or self._run_json
        self.reference_key = _reference_key(reference_key)
        self._anchor_probe = anchor_probe
        self._prepared: dict[str, Any] | None = None

    def prepare_command(self, command: Mapping[str, Any]) -> None:
        command_id = _uuid(command.get("command_id"), "COMMAND_ID_INVALID")
        text = command.get("text")
        if not isinstance(text, str) or not text or len(text) > 500 or "\x00" in text or "\r" in text:
            raise UiaSenderError("TEXT_UNSUPPORTED_BY_UI_ADAPTER")
        self._prepared = {
            "command_id": command_id,
            "test_id": command_id.replace("-", "")[:8].upper(),
            "chat_id": _uuid(command.get("chat_id"), "CHAT_ID_INVALID"),
            "text": text,
            "active_peer": None,
            "outbound_baseline_event_id": None,
        }

    def active_peer(self, chat_id: str) -> Mapping[str, Any]:
        chat = self._chat_binding(_uuid(chat_id, "CHAT_ID_INVALID"))
        marker = self._runner(self._powershell_script("Verify-ActiveMarkerChat.ps1", [
            "-RunId", self.run_id,
        ]), 20)
        composer = self._runner(self._powershell_script("Inspect-ViberComposer.ps1", []), 15)
        marker_ok = (marker.get("status") == "active_marker_chat_verified"
                     and marker.get("complete") is True
                     and marker.get("same_active_feed") is True)
        composer_ready = composer.get("status") in {"composer_ready", "geometry_composer_ready"}
        draft_present = composer.get("draft_present") is True
        observed = self._current_anchor_snapshot() if marker_ok else None
        if observed is not None and (observed["source_chat_ref"] != chat["source_chat_ref"]
                                     or observed["peer_ref"] != chat["peer_ref"]):
            marker_ok = False
        if self._prepared is not None:
            self._prepared["active_peer"] = observed if marker_ok else None
        return {
            "source_chat_ref": observed["source_chat_ref"] if marker_ok and observed else "",
            "peer_ref": observed["peer_ref"] if marker_ok and observed else "",
            "account_verified": bool(marker_ok),
            "foreground_verified": bool(marker_ok),
            "composer_state": "empty" if composer_ready and not draft_present else "foreign_text",
            "layout_verified": bool(composer_ready),
            "dpi_verified": bool(composer_ready),
        }

    def send_text(self, text: str) -> Mapping[str, Any]:
        prepared = self._prepared
        if prepared is None:
            return {"status": "unknown", "error_code": "COMMAND_NOT_PREPARED"}
        if text != prepared["text"]:
            return {"status": "unknown", "error_code": "COMMAND_TEXT_CHANGED"}
        baseline_snapshot = self._current_anchor_snapshot()
        active = prepared.get("active_peer")
        if (not isinstance(active, Mapping)
                or baseline_snapshot["source_chat_ref"] != active.get("source_chat_ref")
                or baseline_snapshot["peer_ref"] != active.get("peer_ref")):
            return {"status": "unknown", "error_code": "ACTIVE_PEER_CHANGED_BEFORE_SEND"}
        baseline = prepared.get("outbound_baseline_event_id")
        if type(baseline) is not int or baseline < baseline_snapshot["anchor_event_id"]:
            return {"status": "unknown", "error_code": "OUTBOUND_BASELINE_MISSING"}
        encoded = base64.b64encode(text.encode("utf-8")).decode("ascii")
        send = self._runner(self._powershell_script("Send-P1Controlled.ps1", [
            "-RunId", self.run_id,
            "-TestId", prepared["test_id"],
            "-ReplyTextBase64", encoded,
        ]), 30)
        if send.get("status") != "submitted_unconfirmed":
            return {
                "status": "unknown" if send.get("dispatch_count") == 1 else "failed",
                "error_code": str(send.get("error_code") or "UI_SEND_FAILED"),
            }
        reconcile = self._runner([
            self.python_exe,
            "-B",
            str(self.runtime_dir / "verify_p1_send_reconcile_live.py"),
            "--test-id",
            prepared["test_id"],
            "--text-base64",
            encoded,
            "--after-event-id",
            str(baseline),
        ], 30)
        if (reconcile.get("status") == "SUBMITTED_UNCONFIRMED"
                and reconcile.get("outbound_occurrence_observed") is True):
            source_event = reconcile.get("outbound_source_event_id")
            if type(source_event) is not int or source_event <= baseline:
                return {"status": "unknown", "error_code": "OUTBOUND_RECONCILIATION_INVALID",
                        "outbound_observed": False, "chat_confirmed": False}
            return {"status": "submitted_unconfirmed", "outbound_observed": True,
                    "chat_confirmed": True,
                    "outbound_baseline_event_id": baseline,
                    "outbound_source_event_id": source_event}
        code = str(reconcile.get("error_code") or "OUTBOUND_RECONCILIATION_MISSING")
        return {"status": "unknown", "error_code": code,
                "outbound_observed": False, "chat_confirmed": False}

    def dispatch_baseline(self) -> int | None:
        prepared = self._prepared
        if prepared is None:
            return None
        active = prepared.get("active_peer")
        snapshot = self._current_anchor_snapshot()
        if (not isinstance(active, Mapping)
                or snapshot["source_chat_ref"] != active.get("source_chat_ref")
                or snapshot["peer_ref"] != active.get("peer_ref")):
            raise UiaSenderError("ACTIVE_PEER_CHANGED_BEFORE_SEND")
        prepared["outbound_baseline_event_id"] = snapshot["max_event_id"]
        return snapshot["max_event_id"]

    def _current_anchor_snapshot(self) -> dict[str, Any]:
        if self._anchor_probe is not None:
            raw = self._anchor_probe()
            if not isinstance(raw, Mapping):
                raise UiaSenderError("ANCHOR_PROBE_INVALID")
            return _anchor_snapshot(raw)
        source = G3SidReadOnlySource(auto_session=True)
        try:
            source.open()
            phone = f"EGXG3-{self.run_id}-PHONE"
            desktop = f"EGXG3-{self.run_id}-DESKTOP"
            anchor = resolve_anchor(source.read_rows, phone, desktop)
            maximum = max_event_id(source.read_rows)
            return {
                "source_chat_ref": source_chat_ref(self.reference_key, anchor["chat_id"]),
                "peer_ref": peer_ref(self.reference_key, anchor["peer_contact_id"]),
                "anchor_event_id": anchor["anchor_event_id"],
                "max_event_id": maximum,
            }
        finally:
            source.close()

    def _chat_binding(self, chat_id: str) -> dict[str, str]:
        try:
            connection = sqlite3.connect(self.state_path)
            connection.row_factory = sqlite3.Row
            try:
                row = connection.execute(
                    "SELECT source_chat_ref, peer_ref, identity_level, chat_kind "
                    "FROM chat_bindings WHERE chat_id=?",
                    (chat_id,),
                ).fetchone()
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise UiaSenderError("LEDGER_READ_FAILED") from error
        if row is None or row["identity_level"] != "verified" or row["chat_kind"] != "one_to_one":
            raise UiaSenderError("CHAT_NOT_VERIFIED")
        source = _ref(row["source_chat_ref"], "SOURCE_CHAT_REF_INVALID")
        peer = _ref(row["peer_ref"], "PEER_REF_INVALID")
        return {"source_chat_ref": source, "peer_ref": peer}

    def _powershell_script(self, name: str, args: Sequence[str]) -> list[str]:
        path = self.runtime_dir / name
        return [self.powershell, "-NoProfile", "-NonInteractive", "-File", str(path), *args]

    def _run_json(self, args: Sequence[str], timeout: int) -> Mapping[str, Any]:
        completed = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout, check=False)
        if completed.returncode not in {0, 2}:
            raise UiaSenderError("UI_ADAPTER_COMMAND_FAILED")
        stdout = completed.stdout.strip()
        if not stdout:
            raise UiaSenderError("UI_ADAPTER_EMPTY_RESULT")
        try:
            value = json.loads(stdout.splitlines()[-1])
        except json.JSONDecodeError as error:
            raise UiaSenderError("UI_ADAPTER_RESULT_INVALID") from error
        if not isinstance(value, Mapping):
            raise UiaSenderError("UI_ADAPTER_RESULT_INVALID")
        return value


def _run_id(value: Any) -> str:
    if not isinstance(value, str) or _RUN_ID.fullmatch(value) is None:
        raise UiaSenderError("RUN_ID_INVALID")
    return value


def _uuid(value: Any, code: str) -> str:
    if not isinstance(value, str) or _UUID.fullmatch(value) is None:
        raise UiaSenderError(code)
    return value


def _ref(value: Any, code: str) -> str:
    if not isinstance(value, str) or _REF.fullmatch(value) is None:
        raise UiaSenderError(code)
    return value


def _reference_key(value: bytes | None) -> bytes:
    if not isinstance(value, bytes) or len(value) < 16:
        raise UiaSenderError("REFERENCE_KEY_INVALID")
    return value


def _source_id(value: Any, code: str) -> int:
    if type(value) is not int or not 0 <= value <= (1 << 63) - 1:
        raise UiaSenderError(code)
    return value


def _anchor_snapshot(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "source_chat_ref": _ref(value.get("source_chat_ref"), "SOURCE_CHAT_REF_INVALID"),
        "peer_ref": _ref(value.get("peer_ref"), "PEER_REF_INVALID"),
        "anchor_event_id": _source_id(value.get("anchor_event_id"), "ANCHOR_EVENT_ID_INVALID"),
        "max_event_id": _source_id(value.get("max_event_id"), "OUTBOUND_BASELINE_INVALID"),
    }
