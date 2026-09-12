"""Exercise the installed Viber Qt SQL plugin using synthetic data only.

The caller supplies a directory containing independently verified, extracted
PySide6-Essentials and shiboken6 6.8.3 wheels. This module installs nothing and
accepts no database path, SQL statement, account identifier, or encryption key.
Run it in a short-lived child process with an external timeout.
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
import hashlib
import importlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from typing import Any


EXPECTED_QT_VERSION = "6.8.3"
EXPECTED_PLUGIN_SHA256 = (
    "eee36d090b774f3295bea740a8de56fc17d609a617c85e6150ef5ee314eba268"
)


class ProbeFailure(Exception):
    """Only the fixed code is suitable for an external diagnostic report."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class QtContext:
    app: Any
    sql: Any
    dll_directory_cookie: Any
    plugin_path: Path


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _installed_plugin_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise ProbeFailure("INSTALL_DIRECTORY_UNAVAILABLE")
    return Path(local_app_data) / "Viber" / "plugins" / "sqldrivers" / "qsqlite.dll"


def _module_path(module_name: str) -> Path:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE
    kernel32.GetModuleFileNameW.argtypes = [
        wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD
    ]
    kernel32.GetModuleFileNameW.restype = wintypes.DWORD
    handle = kernel32.GetModuleHandleW(module_name)
    if not handle:
        raise ProbeFailure("PLUGIN_NOT_LOADED")
    buffer = ctypes.create_unicode_buffer(32768)
    length = kernel32.GetModuleFileNameW(handle, buffer, len(buffer))
    if not length or length >= len(buffer):
        raise ProbeFailure("MODULE_PATH_UNAVAILABLE")
    return Path(buffer.value).resolve()


def initialize_qt(bindings_directory: str | Path) -> QtContext:
    """Initialize verified-version bindings; never load account data here."""
    if os.name != "nt":
        raise ProbeFailure("WINDOWS_REQUIRED")
    # Avoid interactive crash dialogs for this disposable helper only.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.SetErrorMode.argtypes = [wintypes.UINT]
    kernel32.SetErrorMode.restype = wintypes.UINT
    kernel32.SetErrorMode(0x8003)
    bindings_root = Path(bindings_directory).resolve(strict=True)
    if not bindings_root.is_dir():
        raise ProbeFailure("BINDINGS_DIRECTORY_INVALID")
    plugin_path = _installed_plugin_path().resolve(strict=True)
    if _file_hash(plugin_path) != EXPECTED_PLUGIN_SHA256:
        raise ProbeFailure("PLUGIN_HASH_MISMATCH")

    # These settings affect this child only. Do not enable plugin debug output.
    os.environ["QT_DEBUG_PLUGINS"] = "0"
    os.environ["QT_LOGGING_RULES"] = "*.debug=false;*.info=false;*.warning=false;*.critical=false"
    sys.path.insert(0, str(bindings_root))
    pyside = importlib.import_module("PySide6")
    shiboken = importlib.import_module("shiboken6")
    for package in (pyside, shiboken):
        package_file = getattr(package, "__file__", None)
        if not package_file or not Path(package_file).resolve().is_relative_to(bindings_root):
            raise ProbeFailure("BINDINGS_ORIGIN_MISMATCH")
        if getattr(package, "__version__", None) != EXPECTED_QT_VERSION:
            raise ProbeFailure("BINDINGS_VERSION_MISMATCH")

    core = importlib.import_module("PySide6.QtCore")
    core.qInstallMessageHandler(lambda *_args: None)
    sql = importlib.import_module("PySide6.QtSql")
    if core.qVersion() != EXPECTED_QT_VERSION:
        raise ProbeFailure("QT_RUNTIME_VERSION_MISMATCH")
    if core.QCoreApplication.instance() is not None:
        raise ProbeFailure("FRESH_PROCESS_REQUIRED")
    # Load one coherent Qt runtime from the bindings before resolving any
    # additional dependencies of the already installed Viber SQL plugin.
    for module_name in ("Qt6Core.dll", "Qt6Sql.dll"):
        if not _module_path(module_name).is_relative_to(bindings_root):
            raise ProbeFailure("QT_RUNTIME_ORIGIN_MISMATCH")
    dll_cookie = os.add_dll_directory(str(plugin_path.parents[2]))
    app = core.QCoreApplication(["eventgenix-qt-readonly-fixture"])
    core.QCoreApplication.setLibraryPaths([str(plugin_path.parents[1])])
    return QtContext(app=app, sql=sql, dll_directory_cookie=dll_cookie, plugin_path=plugin_path)


def check_plugin_loaded(context: QtContext) -> bool:
    """Fail closed unless the expected installed plugin is actually loaded."""
    loaded_path = _module_path("qsqlite.dll")
    if os.path.normcase(str(loaded_path)) != os.path.normcase(str(context.plugin_path)):
        raise ProbeFailure("PLUGIN_PATH_MISMATCH")
    if _file_hash(loaded_path) != EXPECTED_PLUGIN_SHA256:
        raise ProbeFailure("LOADED_PLUGIN_HASH_MISMATCH")
    return True


def _readonly_connection(context: QtContext, name: str, path: Path) -> Any:
    db = context.sql.QSqlDatabase.addDatabase("QSQLITE", name)
    check_plugin_loaded(context)
    if not db.isValid():
        raise ProbeFailure("SQL_DRIVER_INVALID")
    # query_only is deliberately not used: it would hide a broken open flag.
    db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1000")
    db.setDatabaseName(str(path))
    return db


def run_fixture(context: QtContext) -> dict[str, Any]:
    """Run fixed queries against a temporary synthetic plaintext database."""
    result = {
        "status": "PASS",
        "runtime_version_verified": True,
        "plugin_hash_verified": True,
        "loaded_plugin_path_verified": False,
        "synthetic_select_verified": False,
        "insert_rejected_as_readonly": False,
        "missing_database_open_rejected": False,
        "missing_database_not_created": False,
        "fixture_bytes_unchanged": False,
        "codec_see_compile_option": False,
        "private_database_opened": False,
        "account_data_read": False,
        "keys_used": False,
        "messages_sent": 0,
    }
    with tempfile.TemporaryDirectory(prefix="eventgenix-viber-qt-fixture-") as temporary:
        fixture = Path(temporary) / "synthetic.sqlite"
        missing = Path(temporary) / "missing.sqlite"
        setup = sqlite3.connect(fixture)
        try:
            setup.execute("CREATE TABLE bridge_fixture (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
            setup.execute("INSERT INTO bridge_fixture VALUES (1, ?)", ("synthetic-value",))
            setup.commit()
        finally:
            setup.close()
        original_hash = _file_hash(fixture)
        db = query = None
        connection_name = "eventgenix_synthetic_readonly"
        try:
            db = _readonly_connection(context, connection_name, fixture)
            result["loaded_plugin_path_verified"] = True
            if not db.open():
                raise ProbeFailure("SYNTHETIC_READONLY_OPEN_FAILED")
            query = context.sql.QSqlQuery(db)
            if not query.exec("SELECT id, payload FROM bridge_fixture ORDER BY id"):
                raise ProbeFailure("SYNTHETIC_SELECT_FAILED")
            if not query.next() or query.value(0) != 1 or query.value(1) != "synthetic-value":
                raise ProbeFailure("SYNTHETIC_VALUE_MISMATCH")
            if query.next():
                raise ProbeFailure("SYNTHETIC_ROW_COUNT_MISMATCH")
            query.finish()
            result["synthetic_select_verified"] = True
            if not query.exec("PRAGMA compile_options"):
                raise ProbeFailure("COMPILE_OPTIONS_QUERY_FAILED")
            option_count = 0
            while query.next():
                option_count += 1
                if option_count > 512:
                    raise ProbeFailure("COMPILE_OPTIONS_LIMIT_EXCEEDED")
                if str(query.value(0)) == "CODEC=see":
                    result["codec_see_compile_option"] = True
            query.finish()
            if not result["codec_see_compile_option"]:
                raise ProbeFailure("EXPECTED_CODEC_NOT_CONFIRMED")
            if query.exec("INSERT INTO bridge_fixture VALUES (2, 'unexpected-write')"):
                raise ProbeFailure("READONLY_WRITE_WAS_ALLOWED")
            native_code = query.lastError().nativeErrorCode()
            if not native_code.isdecimal() or int(native_code) & 255 != 8:
                raise ProbeFailure("WRITE_FAILURE_NOT_SQLITE_READONLY")
            query.finish()
            result["insert_rejected_as_readonly"] = True
        finally:
            query = None
            if db is not None:
                db.close()
            db = None
            context.sql.QSqlDatabase.removeDatabase(connection_name)

        result["fixture_bytes_unchanged"] = _file_hash(fixture) == original_hash
        if not result["fixture_bytes_unchanged"]:
            raise ProbeFailure("SYNTHETIC_FIXTURE_CHANGED")
        connection_name = "eventgenix_synthetic_missing"
        try:
            db = _readonly_connection(context, connection_name, missing)
            if db.open():
                raise ProbeFailure("MISSING_DATABASE_OPEN_SUCCEEDED")
            result["missing_database_open_rejected"] = True
        finally:
            if db is not None:
                db.close()
            db = None
            context.sql.QSqlDatabase.removeDatabase(connection_name)
        result["missing_database_not_created"] = not missing.exists()
        if not result["missing_database_not_created"]:
            raise ProbeFailure("MISSING_DATABASE_WAS_CREATED")
    return result


def main() -> int:
    # Native Qt diagnostics can contain paths. The external supervisor receives
    # only the fixed JSON on stdout, including when imports or cleanup fail.
    with open(os.devnull, "w", encoding="utf-8") as null_output:
        os.dup2(null_output.fileno(), 2)
    result: dict[str, Any]
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--worker", action="store_true", required=True)
        parser.add_argument("--bindings", required=True)
        args = parser.parse_args()
        context = initialize_qt(args.bindings)
        result = run_fixture(context)
        code = 0
    except ProbeFailure as failure:
        result = {"status": "FAIL", "error_code": failure.code}
        code = 1
    except BaseException:
        result = {"status": "FAIL", "error_code": "FIXTURE_WORKER_FAILED"}
        code = 1
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
