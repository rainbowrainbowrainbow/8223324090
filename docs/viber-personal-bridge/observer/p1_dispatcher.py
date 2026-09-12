"""Safe command orchestration around an injected Viber UI adapter.

No concrete UI adapter is provided here. Tests use explicit fakes; importing
this module cannot interact with Viber or the desktop.
"""

from __future__ import annotations

from typing import Any, Mapping, Protocol

from p1_bridge_core import BridgeCore, BridgeCoreError


class UiAdapter(Protocol):
    def active_peer(self, chat_id: str) -> Mapping[str, Any]: ...

    def send_text(self, text: str) -> Mapping[str, Any]: ...


class DispatcherError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _active_peer(adapter: UiAdapter, chat_id: str) -> tuple[str, str]:
    try:
        observed = adapter.active_peer(chat_id)
    except Exception:
        raise DispatcherError("ACTIVE_PEER_CHECK_FAILED") from None
    if (not isinstance(observed, Mapping)
            or set(observed) != {"source_chat_ref", "peer_ref"}
            or not isinstance(observed["source_chat_ref"], str)
            or not isinstance(observed["peer_ref"], str)):
        raise DispatcherError("ACTIVE_PEER_CHECK_INVALID")
    return observed["source_chat_ref"], observed["peer_ref"]


def execute_text(core: BridgeCore, command: Mapping[str, Any], adapter: UiAdapter) -> dict[str, Any]:
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
            return core.finish_dispatch(accepted["command_id"], submitted=False)
        except BridgeCoreError as error:
            raise DispatcherError(error.code) from None
    if accepted["status"] != "accepted":
        return accepted

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

    try:
        result = adapter.send_text(accepted["text"])
        submitted = (isinstance(result, Mapping)
                     and set(result) == {"submitted"}
                     and result["submitted"] is True)
    except Exception:
        submitted = False
    try:
        return core.finish_dispatch(accepted["command_id"], submitted=submitted)
    except BridgeCoreError as error:
        raise DispatcherError(error.code) from None
