"""Single-process transport supervisor for the P1 bridge ledger.

Capture and UI dispatch are deliberately separate adapters. This supervisor
can safely keep heartbeat, event ACKs and command intake alive while send is
disabled; it never turns a missing adapter into a UI action.
"""

from __future__ import annotations

from datetime import datetime, timezone
import threading
import time
from typing import Any, Callable, Mapping
from uuid import uuid4

from p1_bridge_core import BridgeCore, BridgeCoreError
from p1_dispatcher import DispatcherError, execute_text
from p1_http_client import BridgeHttpClient, HttpClientError, PROTOCOL_VERSION
from p1_transport import deliver_pending


class DaemonError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class BridgeDaemon:
    def __init__(self, core: BridgeCore, client: BridgeHttpClient, *,
                 runtime_id: str | None = None, clock: Callable[[], float] = time.monotonic,
                 receive_adapter: Any | None = None, dispatch_adapter: Any | None = None):
        if not isinstance(core, BridgeCore) or not isinstance(client, BridgeHttpClient):
            raise DaemonError("DAEMON_DEPENDENCY_INVALID")
        self.core = core
        self.client = client
        self.runtime_id = runtime_id or str(uuid4())
        self._clock = clock
        self.receive_adapter = receive_adapter
        self.dispatch_adapter = dispatch_adapter
        self._stop = threading.Event()
        self._last_heartbeat = float("-inf")

    def envelope(self) -> dict[str, Any]:
        return {
            "protocol_version": PROTOCOL_VERSION,
            "bridge_id": self.core.bridge_id,
            "account_id": self.core.account_id,
            "account_epoch": self.core.account_epoch,
            "business_context": self.core.business_context,
            "runtime_id": self.runtime_id,
        }

    def send_heartbeat(self) -> Mapping[str, Any]:
        diagnostics = self.core.diagnostics()
        sender_available = self.dispatch_adapter is not None
        capabilities = {
            "receive_text": diagnostics["receive_healthy"],
            "send_text": bool(diagnostics["send_text"] and sender_available),
            "sender_adapter": sender_available,
        }
        if self.receive_adapter is not None:
            capabilities.update(self.receive_adapter.capabilities())
            capabilities["send_text"] = bool(diagnostics["send_text"] and sender_available)
            capabilities["sender_adapter"] = sender_available
        response = self.client.heartbeat({
            **self.envelope(),
            "type": "bridge.heartbeat",
            "observed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "capabilities": capabilities,
        })
        self._last_heartbeat = self._clock()
        return response

    def flush_events(self) -> Mapping[str, Any]:
        return deliver_pending(
            self.core,
            runtime_id=self.runtime_id,
            post_json=lambda payload: {"status": 200, "body": self.client.events(payload)},
        )

    def pull_once(self) -> list[dict[str, Any]]:
        response = self.client.pull_commands({**self.envelope(), "limit": 10})
        commands = response.get("commands")
        if not isinstance(commands, list) or len(commands) > 10:
            raise DaemonError("COMMAND_BATCH_INVALID")
        accepted = []
        for raw in commands:
            if not isinstance(raw, Mapping):
                raise DaemonError("COMMAND_BATCH_INVALID")
            command = {key: raw[key] for key in (
                "command_id", "client_request_id", "bridge_id", "account_id", "account_epoch",
                "business_context", "chat_id", "binding_revision", "text") if key in raw}
            try:
                saved = self.core.accept_command(command)
            except BridgeCoreError as error:
                raise DaemonError(error.code) from None
            accepted.append(saved)
            if saved["status"] in {"rejected", "submitted_unconfirmed", "failed", "unknown"}:
                self.report_result(saved["command_id"], saved["status"], saved.get("error_code"))
        return accepted

    def report_result(self, command_id: str, status: str, error_code: str | None = None) -> Mapping[str, Any]:
        if status not in {"dispatch_started", "submitted_unconfirmed", "failed", "unknown", "rejected"}:
            raise DaemonError("COMMAND_STATUS_INVALID")
        payload = {**self.envelope(), "status": status}
        if error_code:
            payload["error_code"] = error_code
        return self.client.command_result(command_id, payload)

    def dispatch_pending(self, *, limit: int = 5) -> list[dict[str, Any]]:
        if self.dispatch_adapter is None:
            return []
        dispatched = []
        for command in self.core.list_dispatchable_commands(limit=limit):
            try:
                result = execute_text(
                    self.core,
                    command,
                    self.dispatch_adapter,
                    on_dispatch_started=lambda command_id: self.report_result(command_id, "dispatch_started"),
                )
            except DispatcherError as error:
                raise DaemonError(error.code) from None
            dispatched.append(result)
            if result.get("status") in {"rejected", "submitted_unconfirmed", "failed", "unknown"}:
                self.report_result(result["command_id"], result["status"], result.get("error_code"))
        return dispatched

    def cycle(self) -> dict[str, Any]:
        receive = None
        if self.receive_adapter is not None:
            receive = self.receive_adapter.scan_once(self.core)
        heartbeat = None
        if self._clock() - self._last_heartbeat >= 15.0:
            heartbeat = self.send_heartbeat()
        events = self.flush_events()
        commands = self.pull_once()
        dispatched = self.dispatch_pending()
        return {"heartbeat": heartbeat is not None, "receive": receive, "events": events,
                "commands": len(commands), "dispatched": len(dispatched)}

    def run(self, *, interval: float = 2.0) -> None:
        for recovered in self.core.recover_interrupted_dispatches_detail():
            try:
                self.report_result(recovered["command_id"], "unknown", recovered.get("error_code"))
            except (HttpClientError, DaemonError, BridgeCoreError):
                pass
        while not self._stop.is_set():
            try:
                self.cycle()
            except (HttpClientError, DaemonError, BridgeCoreError):
                pass
            self._stop.wait(interval)

    def stop(self) -> None:
        self._stop.set()
