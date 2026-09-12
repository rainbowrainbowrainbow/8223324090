"""Safe command orchestration around an injected Viber UI adapter.

No concrete UI adapter is provided here. Tests use explicit fakes; importing
this module cannot interact with Viber or the desktop.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping, Protocol

from p1_bridge_core import BridgeCore, BridgeCoreError


class UiAdapter(Protocol):
    def active_peer(self, chat_id: str) -> Mapping[str, Any]: ...

    def send_text(self, text: str) -> Mapping[str, Any]: ...


class DispatcherError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


_ALLOWED_COMPOSER_STATES = frozenset({"empty", "controlled"})
_TERMINAL_RESULTS = frozenset({"submitted_unconfirmed", "failed", "unknown"})


def _active_peer(adapter: UiAdapter, chat_id: str) -> tuple[str, str]:
    try:
        observed = adapter.active_peer(chat_id)
    except Exception:
        raise DispatcherError("ACTIVE_PEER_CHECK_FAILED") from None
    required = {
        "source_chat_ref", "peer_ref", "account_verified", "foreground_verified",
        "composer_state", "layout_verified", "dpi_verified",
    }
    if not isinstance(observed, Mapping) or set(observed) != required:
        raise DispatcherError("ACTIVE_PEER_CHECK_INVALID")
    if not isinstance(observed["source_chat_ref"], str) or not isinstance(observed["peer_ref"], str):
        raise DispatcherError("ACTIVE_PEER_CHECK_INVALID")
    if observed["account_verified"] is not True:
        raise DispatcherError("VIBER_ACCOUNT_NOT_VERIFIED")
    if observed["foreground_verified"] is not True:
        raise DispatcherError("VIBER_WINDOW_NOT_FOREGROUND")
    if observed["composer_state"] not in _ALLOWED_COMPOSER_STATES:
        raise DispatcherError("COMPOSER_NOT_CONTROLLED")
    if observed["layout_verified"] is not True or observed["dpi_verified"] is not True:
        raise DispatcherError("VIBER_LAYOUT_NOT_VERIFIED")
    return observed["source_chat_ref"], observed["peer_ref"]


def _dispatch_result(result: Any) -> tuple[str, str | None]:
    if not isinstance(result, Mapping):
        return "unknown", "DISPATCH_RESULT_INVALID"
    allowed = {"status", "outbound_observed", "chat_confirmed", "error_code"}
    if not set(result).issubset(allowed) or "status" not in result:
        return "unknown", "DISPATCH_RESULT_INVALID"
    status = result["status"]
    if status not in _TERMINAL_RESULTS:
        return "unknown", "DISPATCH_RESULT_INVALID"
    error = result.get("error_code")
    if error is not None and not isinstance(error, str):
        return "unknown", "DISPATCH_RESULT_INVALID"
    outbound_observed = result.get("outbound_observed")
    chat_confirmed = result.get("chat_confirmed")
    if status == "submitted_unconfirmed":
        if outbound_observed is True and chat_confirmed is True:
            return "submitted_unconfirmed", None
        return "unknown", "OUTBOUND_RECONCILIATION_MISSING"
    if status == "failed":
        return "failed", error or "DISPATCH_FAILED"
    return "unknown", error or "DISPATCH_RESULT_UNKNOWN"


def execute_text(core: BridgeCore, command: Mapping[str, Any], adapter: UiAdapter, *,
                 on_dispatch_started: Callable[[str], Any] | None = None) -> dict[str, Any]:
    """Run at most one UI send attempt for one durable command identity."""
    if not isinstance(core, BridgeCore):
        raise DispatcherError("CORE_INVALID")
    if adapter is None or not callable(getattr(adapter, "active_peer", None)) or not callable(getattr(adapter, "send_text", None)):
        raise DispatcherError("UI_ADAPTER_INVALID")
    try:
        accepted = core.accept_command(command)
    except BridgeCoreError as error:
        raise DispatcherError(error.code) from None

    # A previous invocation may have crossed the irreversible boundary. Never
    # touch UI again for that command, even if the process did not restart.
    if accepted["status"] == "dispatch_started":
        try:
            return core.finish_dispatch(accepted["command_id"], status="unknown", error_code="DISPATCH_INTERRUPTED")
        except BridgeCoreError as error:
            raise DispatcherError(error.code) from None
    if accepted["status"] != "accepted":
        return accepted

    prepare = getattr(adapter, "prepare_command", None)
    if callable(prepare):
        try:
            prepare(accepted)
        except Exception:
            raise DispatcherError("UI_ADAPTER_PREPARE_FAILED") from None

    source_chat_ref, peer_ref = _active_peer(adapter, accepted["chat_id"])
    try:
        started = core.begin_dispatch(
            accepted["command_id"],
            observed_source_chat_ref=source_chat_ref,
            observed_peer_ref=peer_ref,
        )
    except BridgeCoreError as error:
        if error.code == "UI_OPERATION_BUSY":
            return {**accepted, "deferred": True, "error_code": error.code}
        raise DispatcherError(error.code) from None
    if started["status"] != "dispatch_started":
        return started

    if on_dispatch_started is not None:
        try:
            on_dispatch_started(accepted["command_id"])
        except Exception:
            try:
                return core.finish_dispatch(accepted["command_id"], status="unknown",
                                            error_code="DISPATCH_START_REPORT_FAILED")
            except BridgeCoreError as error:
                raise DispatcherError(error.code) from None

    try:
        result = adapter.send_text(accepted["text"])
        status, error_code = _dispatch_result(result)
    except Exception:
        status, error_code = "unknown", "DISPATCH_RESULT_UNKNOWN"
    try:
        return core.finish_dispatch(accepted["command_id"], status=status, error_code=error_code)
    except BridgeCoreError as error:
        raise DispatcherError(error.code) from None
