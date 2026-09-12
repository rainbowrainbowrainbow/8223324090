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
                 powershell: str | None = None, python_exe: str | None = None):
        self.state_path = Path(state_path)
        self.runtime_dir = Path(runtime_dir) if runtime_dir is not None else Path(__file__).resolve().parent
        self.run_id = _run_id(run_id)
        self.powershell = powershell or "powershell.exe"
        self.python_exe = python_exe or sys.executable
        self._runner = runner or self._run_json
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
        return {
            "source_chat_ref": chat["source_chat_ref"],
            "peer_ref": chat["peer_ref"],
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
        ], 30)
        if (reconcile.get("status") == "SUBMITTED_UNCONFIRMED"
                and reconcile.get("outbound_occurrence_observed") is True):
            return {"status": "submitted_unconfirmed", "outbound_observed": True, "chat_confirmed": True}
        code = str(reconcile.get("error_code") or "OUTBOUND_RECONCILIATION_MISSING")
        return {"status": "unknown", "error_code": code,
                "outbound_observed": False, "chat_confirmed": False}

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
