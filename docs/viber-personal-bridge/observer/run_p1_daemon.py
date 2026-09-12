"""Start the fail-closed Viber Personal Bridge transport from a private config.

The config and SQLite ledger must remain outside the repository. Capture and
dispatch stay adapter-gated: a missing adapter reports a blocked capability
instead of pretending the bridge is ready.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import ctypes
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any, Mapping
from uuid import UUID, uuid4

from p1_bridge_core import BridgeCore, BridgeCoreError
from p1_daemon import BridgeDaemon, DaemonError
from p1_http_client import BridgeHttpClient, HttpClientError
from p1_live_inbound import (
    G3SidReadOnlySource, LiveInboundAdapter, LiveInboundJournal, LiveInboundError, SqliteReadOnlySource,
)


class LauncherError(Exception):
    pass


def _runtime_id_path(config: Mapping[str, Any]) -> Path:
    explicit = config.get("runtime_id_path")
    if isinstance(explicit, str) and explicit:
        path = Path(explicit)
        if not path.is_absolute():
            raise LauncherError("RUNTIME_ID_PATH_INVALID")
        return path
    return Path(config["state_path"]).with_name("runtime_id.txt")


def _load_or_create_runtime_id(config: Mapping[str, Any]) -> str:
    path = _runtime_id_path(config)
    try:
        if path.exists():
            runtime_id = path.read_text(encoding="utf-8").strip().lower()
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            runtime_id = str(uuid4())
            path.write_text(runtime_id + "\n", encoding="utf-8")
        parsed = UUID(runtime_id)
        if str(parsed) != runtime_id or parsed.version not in {1, 2, 3, 4, 5}:
            raise ValueError("runtime id invalid")
        return runtime_id
    except (OSError, UnicodeError, ValueError) as error:
        raise LauncherError("RUNTIME_ID_UNAVAILABLE") from error


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
    if raw.get("runtime_id_path") is not None:
        _runtime_id_path(raw)
    live = raw.get("live_inbound")
    if live is not None:
        if not isinstance(live, dict) or not isinstance(live.get("enabled"), bool):
            raise LauncherError("LIVE_INBOUND_CONFIG_INVALID")
        if live.get("enabled"):
            source_kind = live.get("source_kind") or ("sqlite_fixture" if live.get("source_db_path") else "g3_sid")
            if source_kind not in {"g3_sid", "sqlite_fixture"}:
                raise LauncherError("LIVE_INBOUND_SOURCE_KIND_INVALID")
            required_live = {"journal_path", "reference_key", "phone_marker", "desktop_marker"}
            if required_live - live.keys():
                raise LauncherError("LIVE_INBOUND_CONFIG_INVALID")
            if not isinstance(live["journal_path"], str) or not Path(live["journal_path"]).is_absolute():
                raise LauncherError("LIVE_INBOUND_PATH_INVALID")
            if source_kind == "sqlite_fixture":
                if not isinstance(live.get("source_db_path"), str) or not Path(live["source_db_path"]).is_absolute():
                    raise LauncherError("LIVE_INBOUND_PATH_INVALID")
            else:
                if "source_db_path" in live:
                    raise LauncherError("LIVE_INBOUND_CONFIG_INVALID")
                if live.get("session_path") is not None and (not isinstance(live["session_path"], str)
                                                            or not Path(live["session_path"]).is_absolute()):
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
    source_kind = live.get("source_kind") or ("sqlite_fixture" if live.get("source_db_path") else "g3_sid")
    if source_kind == "sqlite_fixture":
        source = SqliteReadOnlySource(live["source_db_path"])
        account_identity = live.get("account_identity") or config["account_id"]
        source_identity = live.get("source_identity") or str(Path(live["source_db_path"]).resolve())
    elif source_kind == "g3_sid":
        source = G3SidReadOnlySource(session_path=live.get("session_path"),
                                     auto_session=not bool(live.get("session_path")))
        account_identity = None
        source_identity = None
    else:
        raise LauncherError("LIVE_INBOUND_SOURCE_KIND_INVALID")
    try:
        expected_version = live.get("expected_viber_version")
        if expected_version is not None:
            desktop = viber_desktop_preflight(config)
            if desktop.get("version") != expected_version:
                raise LauncherError("VIBER_BUILD_MISMATCH")
        source.open()
        journal = LiveInboundJournal(live["journal_path"])
        return LiveInboundAdapter(
            journal=journal,
            reader=source.read_rows,
            reference_key=_reference_key(live["reference_key"]),
            phone_marker=live["phone_marker"],
            desktop_marker=live["desktop_marker"],
            account_identity=account_identity or source.account_identity,
            source_identity=source_identity or source.source_identity,
            source_handle=source,
        )
    except Exception:
        source.close()
        raise


def _windows_file_version(path: Path) -> str | None:
    if os.name != "nt":
        return None
    try:
        version = ctypes.windll.version
        size = version.GetFileVersionInfoSizeW(str(path), None)
        if not size:
            return None
        buffer = ctypes.create_string_buffer(size)
        if not version.GetFileVersionInfoW(str(path), 0, size, buffer):
            return None
        value = ctypes.c_void_p()
        length = ctypes.c_uint()
        if not version.VerQueryValueW(buffer, "\\", ctypes.byref(value), ctypes.byref(length)):
            return None
        fixed = ctypes.cast(value, ctypes.POINTER(ctypes.c_uint32 * 13)).contents
        ms = fixed[2]
        ls = fixed[3]
        return ".".join(str(part) for part in (
            ms >> 16,
            ms & 0xFFFF,
            ls >> 16,
            ls & 0xFFFF,
        ))
    except Exception:
        return None


def _default_viber_executable() -> Path | None:
    candidates = []
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "Viber" / "Viber.exe")
    program_files = [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")]
    for root in program_files:
        if root:
            candidates.append(Path(root) / "Viber" / "Viber.exe")
    return next((path for path in candidates if path.is_file()), None)


def viber_desktop_preflight(config: Mapping[str, Any]) -> dict[str, Any]:
    configured_path = config.get("viber_executable_path")
    path = Path(configured_path) if isinstance(configured_path, str) and configured_path else _default_viber_executable()
    present = bool(path and path.is_file())
    return {
        "configured": configured_path is not None,
        "present": present,
        "path": str(path) if path else None,
        "version": _windows_file_version(path) if present else None,
        "blockReason": None if present else "VIBER_DESKTOP_NOT_FOUND",
    }


def runtime_preflight(config: Mapping[str, Any], *, runtime_dir: Path | None = None) -> dict[str, Any]:
    live = config.get("live_inbound")
    live_enabled = isinstance(live, Mapping) and live.get("enabled") is True
    runtime_root = runtime_dir or Path(__file__).resolve().parent
    required_modules = [
        "g3_process.py",
        "g3_state.py",
        "observe_g3.py",
        "observe_g3_sid.py",
        "p1_bridge_core.py",
        "p1_daemon.py",
        "p1_dispatcher.py",
        "p1_http_client.py",
        "p1_live_inbound.py",
        "p1_paired_queries.py",
        "p1_transport.py",
        "probe_db_schema.py",
        "probe_key_presence.py",
        "qt_readonly_fixture.py",
        "recover_sid_key.py",
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
        source_kind = live.get("source_kind") or ("sqlite_fixture" if live.get("source_db_path") else "g3_sid")
        journal_path = Path(live["journal_path"])
        desktop = viber_desktop_preflight(config)
        live_checks = {
            "sourceKind": source_kind,
            "journalParentExists": journal_path.parent.exists(),
            "phoneMarkerConfigured": isinstance(live.get("phone_marker"), str) and bool(live.get("phone_marker")),
            "desktopMarkerConfigured": isinstance(live.get("desktop_marker"), str) and bool(live.get("desktop_marker")),
            "viberDesktopPresent": desktop.get("present") is True,
        }
        if live.get("expected_viber_version") is not None:
            live_checks["viberBuildMatches"] = desktop.get("version") == live.get("expected_viber_version")
        if source_kind == "sqlite_fixture":
            source_path = Path(live["source_db_path"])
            live_checks["sourceDbExists"] = source_path.exists() and source_path.is_file()
        elif source_kind == "g3_sid":
            live_checks["sourceDbPathHidden"] = "source_db_path" not in live
            live_checks["g3SessionMode"] = "explicit" if live.get("session_path") else "auto"
            try:
                from observe_g3_sid import find_single_session
                if live.get("session_path"):
                    live_checks["g3SessionAvailable"] = Path(live["session_path"]).is_dir()
                else:
                    find_single_session()
                    live_checks["g3SessionAvailable"] = True
            except Exception:
                live_checks["g3SessionAvailable"] = False
        else:
            live_checks["sourceKindSupported"] = False
        live_status = "ready_for_scan" if all(value is not False for value in live_checks.values()) else "blocked"
    return {
        "ok": all(item["present"] for item in modules.values()),
        "bridge_id": config["bridge_id"],
        "account_id": config["account_id"],
        "account_epoch": config["account_epoch"],
        "business_context": config["business_context"],
        "statePathExists": Path(config["state_path"]).exists(),
        "runtimeIdPath": str(_runtime_id_path(config)),
        "runtimeIdPresent": _runtime_id_path(config).is_file(),
        "modules": modules,
        "liveInbound": {
            "enabled": live_enabled,
            "status": live_status,
            "blockReason": (None if live_status == "ready_for_scan" else
                            "CAPTURE_NOT_CONFIGURED" if not live_enabled else "CAPTURE_BLOCKED"),
            **live_checks,
        },
        "sender": {
            "enabled": False,
            "status": "disabled",
            "blockReason": "SENDER_NOT_CONFIGURED",
            "adapterModulePresent": modules.get("p1_dispatcher.py", {}).get("present") is True,
        },
        "viberDesktop": viber_desktop_preflight(config),
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
        return BridgeDaemon(core, client, runtime_id=_load_or_create_runtime_id(config),
                            receive_adapter=receive_adapter)
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
