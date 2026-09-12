"""Strict event batching for a future outbound HTTPS transport.

The caller supplies the HTTP function. This module does not open sockets and
only removes local pending events after a valid, explicit per-event ACK.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Mapping

from p1_bridge_core import BridgeCore, BridgeCoreError


PROTOCOL_VERSION = "1.0"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class TransportError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def event_batch(core: BridgeCore, *, runtime_id: str, limit: int = 50) -> dict[str, Any]:
    if not isinstance(core, BridgeCore):
        raise TransportError("CORE_INVALID")
    try:
        runtime = runtime_id
        if not isinstance(runtime, str) or _UUID.fullmatch(runtime) is None:
            raise TransportError("RUNTIME_ID_INVALID")
        pending = core.list_pending_events(limit)
    except BridgeCoreError as error:
        raise TransportError(error.code) from None
    events = []
    for row in pending:
        events.append({
            "protocol_version": PROTOCOL_VERSION,
            "type": "message.observed",
            "bridge_id": core.bridge_id,
            "account_id": core.account_id,
            "account_epoch": core.account_epoch,
            "business_context": core.business_context,
            "runtime_id": runtime,
            "event_id": row["event_id"],
            "sequence": str(row["sequence"]),
            "observed_at": row["observed_at"],
            "chat_id": row["chat_id"],
            "binding_revision": row["binding_revision"],
            "identity": {"level": row["identity_level"], "peer_ref": row["peer_ref"]},
            "message": {
                "direction": row["direction"],
                "origin": row["origin"],
                "text": row["text"],
            },
        })
    return {"protocol_version": PROTOCOL_VERSION, "events": events}


def deliver_pending(core: BridgeCore, *, runtime_id: str,
                    post_json: Callable[[dict[str, Any]], Mapping[str, Any]],
                    limit: int = 50) -> dict[str, Any]:
    """Attempt one batch. Network ambiguity always preserves pending events."""
    if not callable(post_json):
        raise TransportError("TRANSPORT_INVALID")
    payload = event_batch(core, runtime_id=runtime_id, limit=limit)
    expected = {event["event_id"] for event in payload["events"]}
    if not expected:
        return {"attempted": False, "sent": 0, "acked": 0, "pending": 0,
                "status": "idle"}
    try:
        response = post_json(payload)
    except Exception:
        return {"attempted": True, "sent": len(expected), "acked": 0,
                "pending": len(core.list_pending_events(limit)), "status": "unknown"}
    if not isinstance(response, Mapping) or set(response) != {"status", "body"}:
        raise TransportError("HTTP_RESPONSE_INVALID")
    status, body = response["status"], response["body"]
    if type(status) is not int or not isinstance(body, Mapping):
        raise TransportError("HTTP_RESPONSE_INVALID")
    if status != 200:
        return {"attempted": True, "sent": len(expected), "acked": 0,
                "pending": len(core.list_pending_events(limit)), "status": "retryable"}
    if set(body) != {"protocol_version", "acked_event_ids"} or body["protocol_version"] != PROTOCOL_VERSION:
        raise TransportError("ACK_RESPONSE_INVALID")
    acked = body["acked_event_ids"]
    if (not isinstance(acked, list) or len(acked) > len(expected)
            or any(not isinstance(event_id, str) for event_id in acked)
            or len(set(acked)) != len(acked) or not set(acked).issubset(expected)):
        raise TransportError("ACK_RESPONSE_INVALID")
    try:
        changed = core.ack_events(acked)
        pending = len(core.list_pending_events(limit))
    except BridgeCoreError as error:
        raise TransportError(error.code) from None
    return {"attempted": True, "sent": len(expected), "acked": changed,
            "pending": pending, "status": "acked" if changed else "unacknowledged"}
