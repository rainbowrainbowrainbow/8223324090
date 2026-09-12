"""Start the fail-closed Viber Personal Bridge transport from a private config.

The config and SQLite ledger must remain outside the repository. Capture and
dispatch stay adapter-gated: a missing adapter reports a blocked capability
instead of pretending the bridge is ready.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
from pathlib import Path
import sys
from typing import Any, Mapping

from p1_bridge_core import BridgeCore, BridgeCoreError
from p1_daemon import BridgeDaemon, DaemonError
from p1_http_client import BridgeHttpClient, HttpClientError
from p1_live_inbound import LiveInboundAdapter, LiveInboundJournal, LiveInboundError, SqliteReadOnlySource


class LauncherError(Exception):
    pass


def _load_config(path: Path) -> Mapping[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise LauncherError("CONFIG_READ_FAILED") from error
    required = {
        "crm_base_url", "bridge_id", "account_id", "account_epoch",
        "business_context", "token", "state_path",
    }
    if not isinstance(raw, dict) or required - raw.keys():
        raise LauncherError("CONFIG_INVALID")
    if not isinstance(raw["state_path"], str) or not Path(raw["state_path"]).is_absolute():
        raise LauncherError("STATE_PATH_INVALID")
    live = raw.get("live_inbound")
    if live is not None:
        if not isinstance(live, dict) or not isinstance(live.get("enabled"), bool):
            raise LauncherError("LIVE_INBOUND_CONFIG_INVALID")
        if live.get("enabled"):
            required_live = {"source_db_path", "journal_path", "reference_key", "phone_marker", "desktop_marker"}
            if required_live - live.keys():
                raise LauncherError("LIVE_INBOUND_CONFIG_INVALID")
            for key in ("source_db_path", "journal_path"):
                if not isinstance(live[key], str) or not Path(live[key]).is_absolute():
                    raise LauncherError("LIVE_INBOUND_PATH_INVALID")
    return raw


def _reference_key(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise LauncherError("REFERENCE_KEY_INVALID")
    try:
        if len(value) == 64 and all(char in "0123456789abcdefABCDEF" for char in value):
            decoded = bytes.fromhex(value)
        else:
            decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise LauncherError("REFERENCE_KEY_INVALID") from None
    if len(decoded) < 16:
        raise LauncherError("REFERENCE_KEY_INVALID")
    return decoded


def _build_receive_adapter(config: Mapping[str, Any]) -> LiveInboundAdapter | None:
    live = config.get("live_inbound")
    if not isinstance(live, Mapping) or not live.get("enabled"):
        return None
    source = SqliteReadOnlySource(live["source_db_path"])
    try:
        source.open()
        journal = LiveInboundJournal(live["journal_path"])
        return LiveInboundAdapter(
            journal=journal,
            reader=source.read_rows,
            reference_key=_reference_key(live["reference_key"]),
            phone_marker=live["phone_marker"],
            desktop_marker=live["desktop_marker"],
            account_identity=live.get("account_identity") or config["account_id"],
            source_identity=live.get("source_identity") or str(Path(live["source_db_path"]).resolve()),
            source_handle=source,
        )
    except Exception:
        source.close()
        raise


def runtime_preflight(config: Mapping[str, Any], *, runtime_dir: Path | None = None) -> dict[str, Any]:
    live = config.get("live_inbound")
    live_enabled = isinstance(live, Mapping) and live.get("enabled") is True
    runtime_root = runtime_dir or Path(__file__).resolve().parent
    required_modules = [
        "p1_bridge_core.py",
        "p1_daemon.py",
        "p1_dispatcher.py",
        "p1_http_client.py",
        "p1_live_inbound.py",
        "p1_paired_queries.py",
        "p1_transport.py",
        "run_p1_daemon.py",
    ]
    modules = {}
    for name in required_modules:
        module_path = runtime_root / name
        modules[name] = {
            "present": module_path.is_file(),
            "sha256": hashlib.sha256(module_path.read_bytes()).hexdigest() if module_path.is_file() else None,
        }
    live_status = "disabled"
    live_checks: dict[str, Any] = {}
    if live_enabled:
        source_path = Path(live["source_db_path"])
        journal_path = Path(live["journal_path"])
        live_checks = {
            "sourceDbExists": source_path.exists() and source_path.is_file(),
            "journalParentExists": journal_path.parent.exists(),
            "phoneMarkerConfigured": isinstance(live.get("phone_marker"), str) and bool(live.get("phone_marker")),
            "desktopMarkerConfigured": isinstance(live.get("desktop_marker"), str) and bool(live.get("desktop_marker")),
        }
        live_status = "ready_for_scan" if all(live_checks.values()) else "blocked"
    return {
        "ok": all(item["present"] for item in modules.values()),
        "bridge_id": config["bridge_id"],
        "account_id": config["account_id"],
        "account_epoch": config["account_epoch"],
        "business_context": config["business_context"],
        "statePathExists": Path(config["state_path"]).exists(),
        "modules": modules,
        "liveInbound": {
            "enabled": live_enabled,
            "status": live_status,
            "blockReason": None if live_enabled else "CAPTURE_NOT_CONFIGURED",
            **live_checks,
        },
    }


def build_daemon(config: Mapping[str, Any]) -> BridgeDaemon:
    core = BridgeCore(
        config["state_path"],
        bridge_id=config["bridge_id"],
        account_id=config["account_id"],
        account_epoch=config["account_epoch"],
        business_context=config["business_context"],
    )
    try:
        client = BridgeHttpClient(config["crm_base_url"], config["token"])
        receive_adapter = _build_receive_adapter(config)
        return BridgeDaemon(core, client, receive_adapter=receive_adapter)
    except Exception:
        core.close()
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="EventGenix Viber Personal Bridge transport")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--once", action="store_true", help="Run one transport cycle and exit")
    parser.add_argument("--preflight", action="store_true", help="Validate local runtime and config without contacting CRM")
    args = parser.parse_args(argv)
    daemon = None
    try:
        config = _load_config(args.config.resolve())
        if args.preflight:
            print(json.dumps(runtime_preflight(config), separators=(",", ":")))
            return 0
        daemon = build_daemon(config)
        if args.once:
            result = daemon.cycle()
            print(json.dumps({"ok": True, **result}, separators=(",", ":")))
        else:
            daemon.run()
        return 0
    except (LauncherError, BridgeCoreError, HttpClientError, DaemonError, LiveInboundError) as error:
        code = getattr(error, "code", str(error))
        print(json.dumps({"ok": False, "error": code}, separators=(",", ":")), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if daemon is not None:
            daemon.stop()
            if daemon.receive_adapter is not None and hasattr(daemon.receive_adapter, "close"):
                daemon.receive_adapter.close()
            daemon.core.close()


if __name__ == "__main__":
    raise SystemExit(main())
