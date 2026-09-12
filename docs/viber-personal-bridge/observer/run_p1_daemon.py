"""Start the fail-closed Viber Personal Bridge transport from a private config.

The config and SQLite ledger must remain outside the repository. This launcher
does not capture Viber messages or dispatch UI actions; it only maintains the
authenticated CRM transport while those adapters are unavailable.
"""

from __future__ import annotations

import argparse
import base64
import binascii
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
    args = parser.parse_args(argv)
    daemon = None
    try:
        daemon = build_daemon(_load_config(args.config.resolve()))
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
