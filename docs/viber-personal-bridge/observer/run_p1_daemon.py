"""Start the fail-closed Viber Personal Bridge transport from a private config.

The config and SQLite ledger must remain outside the repository. This launcher
does not capture Viber messages or dispatch UI actions; it only maintains the
authenticated CRM transport while those adapters are unavailable.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Mapping

from p1_bridge_core import BridgeCore, BridgeCoreError
from p1_daemon import BridgeDaemon, DaemonError
from p1_http_client import BridgeHttpClient, HttpClientError


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
    return raw


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
        return BridgeDaemon(core, client)
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
    except (LauncherError, BridgeCoreError, HttpClientError, DaemonError) as error:
        code = getattr(error, "code", str(error))
        print(json.dumps({"ok": False, "error": code}, separators=(",", ":")), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if daemon is not None:
            daemon.stop()
            daemon.core.close()


if __name__ == "__main__":
    raise SystemExit(main())
