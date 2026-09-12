"""Supervised, owner-authorized Windows Viber schema feasibility check.

Requires verified Qt wheels in --bindings. Never accepts a key, SQL or account
path from CLI. No message/contact rows, exports, process writes or sending.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys


EXPECTED = {
    "Events": ["EventID", "ChatID", "ContactID", "TimeStamp", "Direction"],
    "Messages": ["EventID", "Body"],
    "Contact": ["ContactID", "Number"],
    "ChatInfo": ["ChatID", "Token"],
}
STATUSES = {
    "NOT_RUN", "SCHEMA_READABLE", "SCHEMA_VARIANT", "READABLE_WITHOUT_SUPPLIED_KEY",
    "CANDIDATE_UNAVAILABLE", "KEY_NOT_VALIDATED", "DATABASE_BUSY", "DATABASE_OPEN_FAILED",
    "FIXTURE_FAILED", "DATABASE_PATH_NOT_UNIQUE", "DATABASE_PATH_REJECTED",
    "DATABASE_CHANGED", "TARGET_NOT_VERIFIED", "WORKER_FAILED", "WORKER_TIMEOUT",
    "DATABASE_SIDECAR_UNAVAILABLE",
}


def result_template():
    return {
        "report_version": 1,
        "status": "NOT_RUN",
        "target_verified": False,
        "synthetic_fixture_passed": False,
        "codec_see_verified": False,
        "candidate_count": 0,
        "candidate_limit_reached": False,
        "candidate_scan_bytes": 0,
        "candidate_scan_complete": False,
        "database_open_attempts": 0,
        "private_database_opened": False,
        "baseline_schema_readable": False,
        "local_database_readable": False,
        "expected_schema_present": False,
        "supplied_key_validated_by_schema": False,
        "last_sqlite_base_error": 0,
        "wal_existed_before": False,
        "shm_existed_before": False,
        "wal_exists_after": False,
        "shm_exists_after": False,
        "database_file_identity_unchanged": False,
        "schema": {table: {column: False for column in columns} for table, columns in EXPECTED.items()},
        "message_or_contact_rows_queried": False,
        "keys_exported": False,
        "messages_sent": 0,
    }


def validate_result(value):
    template = result_template()
    if not isinstance(value, dict) or value.keys() != template.keys() or value.get("status") not in STATUSES:
        return False
    for key, expected in template.items():
        if type(value[key]) is not type(expected):
            return False
        if type(expected) is int and not 0 <= value[key] <= 536870912:
            return False
    if value["schema"].keys() != EXPECTED.keys():
        return False
    for table, columns in EXPECTED.items():
        if not isinstance(value["schema"][table], dict) or value["schema"][table].keys() != dict.fromkeys(columns).keys():
            return False
        if any(type(v) is not bool for v in value["schema"][table].values()):
            return False
    if value["candidate_count"] > 4 or value["database_open_attempts"] > 5:
        return False
    if value["status"] in {"SCHEMA_READABLE", "SCHEMA_VARIANT", "READABLE_WITHOUT_SUPPLIED_KEY"} and not all(value[k] for k in [
        "target_verified", "synthetic_fixture_passed", "codec_see_verified", "local_database_readable",
        "database_file_identity_unchanged",
    ]):
        return False
    if value["status"] == "SCHEMA_READABLE" and not all(value[k] for k in ["expected_schema_present", "supplied_key_validated_by_schema"]):
        return False
    return (value["report_version"] == 1 and not value["keys_exported"]
            and not value["message_or_contact_rows_queried"] and value["messages_sent"] == 0)


def hex_pragma(candidate):
    if type(candidate) is not bytes or not re.fullmatch(rb"(?:[0-9a-fA-F]{2}){1,512}", candidate):
        raise ValueError("INVALID_CANDIDATE")
    return "PRAGMA hexkey='" + candidate.decode("ascii") + "'"


def load_local(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def collect_candidates(probe):
    candidates = []
    limit_reached = False

    def capture(data):
        nonlocal limit_reached
        for pattern, wide in [(probe.ASCII_KEY, False), (probe.UTF16_KEY, True)]:
            for match in pattern.finditer(data):
                statement = match.group(0)
                if wide:
                    statement = statement[::2]
                candidate = statement.split(b"'", 2)[1].lower()
                if not re.fullmatch(rb"(?:[0-9a-f]{2}){1,512}", candidate):
                    continue
                if candidate not in candidates:
                    if len(candidates) == 4:
                        limit_reached = True
                        break
                    candidates.append(candidate)
        return bool(candidates)

    original = probe.contains_candidate
    try:
        probe.contains_candidate = capture
        scan = probe.worker()
        return candidates, limit_reached, scan
    finally:
        probe.contains_candidate = original


def base_error(error):
    code = error.nativeErrorCode()
    return (int(code) & 255) if code.isdecimal() and len(code) < 10 else 0


def read_expected_schema(context, query):
    schema = {table: {column: False for column in columns} for table, columns in EXPECTED.items()}
    # Fixed schema names only; no data rows or arbitrary schema names are returned.
    if not query.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Events','Messages','Contact','ChatInfo') LIMIT 5"):
        return False, schema, base_error(query.lastError())
    tables = set()
    while query.next():
        tables.add(query.value(0))
    query.finish()
    for table, columns in EXPECTED.items():
        if table not in tables:
            continue
        # table comes from the constant allowlist above, never from untrusted SQL.
        if not query.exec('PRAGMA table_info("' + table + '")'):
            return False, schema, base_error(query.lastError())
        count = 0
        while query.next():
            count += 1
            if count > 256:
                return False, schema, 0
            column = query.value(1)
            if column in columns:
                schema[table][column] = True
        query.finish()
    return True, schema, 0


def check_one(context, path, candidate, number):
    name = "eventgenix_private_schema_" + str(number)
    db = query = None
    opened = False
    try:
        db = context.sql.QSqlDatabase.addDatabase("QSQLITE", name)
        db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1000")
        db.setDatabaseName(str(path))
        if not db.open():
            return False, False, None, base_error(db.lastError())
        opened = True
        query = context.sql.QSqlQuery(db)
        if candidate is not None and not query.exec(hex_pragma(candidate)):
            return True, False, None, base_error(query.lastError())
        query.finish()
        if not query.exec("PRAGMA query_only=ON"):
            return True, False, None, base_error(query.lastError())
        query.finish()
        readable, schema, error = read_expected_schema(context, query)
        return True, readable, schema, error
    finally:
        if query is not None:
            query.finish()
        query = None
        if db is not None:
            db.close()
        db = None
        context.sql.QSqlDatabase.removeDatabase(name)


def worker(bindings):
    result = result_template()
    candidates = []
    with open(os.devnull, "w", encoding="utf-8") as null:
        os.dup2(null.fileno(), 2)
    try:
        fixture = load_local("qt_readonly_fixture")
        context = fixture.initialize_qt(bindings)
        proof = fixture.run_fixture(context)
        if proof.get("status") != "PASS":
            result["status"] = "FIXTURE_FAILED"
            return result
        result["synthetic_fixture_passed"] = True
        result["codec_see_verified"] = proof["codec_see_compile_option"]
        probe = load_local("probe_key_presence")
        candidates, limited, scan = collect_candidates(probe)
        result["target_verified"] = scan["target_verified"]
        result["candidate_count"] = len(candidates)
        result["candidate_limit_reached"] = limited
        result["candidate_scan_bytes"] = scan["bytes_read"]
        result["candidate_scan_complete"] = scan["private_region_scan_complete"]
        if not scan["target_verified"] or scan["status"] == "target_exited":
            result["status"] = "TARGET_NOT_VERIFIED"
            return result
        if not candidates:
            result["status"] = "CANDIDATE_UNAVAILABLE"
            return result
        data_root = (Path(os.environ["APPDATA"]) / "ViberPC").resolve(strict=True)
        paths = list(data_root.glob("*/viber.db"))
        if len(paths) != 1:
            result["status"] = "DATABASE_PATH_NOT_UNIQUE"
            return result
        path = paths[0].resolve(strict=True)
        if not path.is_relative_to(data_root) or not path.is_file():
            result["status"] = "DATABASE_PATH_REJECTED"
            return result
        initial = path.stat()
        identity = (initial.st_dev, initial.st_ino)
        wal, shm = Path(str(path) + "-wal"), Path(str(path) + "-shm")
        result["wal_existed_before"], result["shm_existed_before"] = wal.exists(), shm.exists()
        if result["wal_existed_before"] and not result["shm_existed_before"]:
            result["status"] = "DATABASE_SIDECAR_UNAVAILABLE"
            return result
        result["status"] = "KEY_NOT_VALIDATED"
        # A no-key baseline separates automatic/default readability from key proof.
        for index, candidate in enumerate([None] + candidates):
            current = path.stat()
            if (current.st_dev, current.st_ino) != identity:
                result["status"] = "DATABASE_CHANGED"
                break
            result["database_open_attempts"] += 1
            opened, readable, schema, error = check_one(context, path, candidate, index)
            fixture.check_plugin_loaded(context)
            result["private_database_opened"] |= opened
            result["last_sqlite_base_error"] = error
            if index == 0:
                result["baseline_schema_readable"] = readable
            if readable:
                result["local_database_readable"] = True
                result["schema"] = schema
                result["expected_schema_present"] = all(v for columns in schema.values() for v in columns.values())
                result["supplied_key_validated_by_schema"] = candidate is not None and result["expected_schema_present"]
                if candidate is None:
                    result["status"] = "READABLE_WITHOUT_SUPPLIED_KEY"
                else:
                    result["status"] = "SCHEMA_READABLE" if result["expected_schema_present"] else "SCHEMA_VARIANT"
                break
            if error in (5, 6):
                result["status"] = "DATABASE_BUSY"
                break
            if not opened:
                result["status"] = "DATABASE_OPEN_FAILED"
                break
        final = path.stat()
        result["database_file_identity_unchanged"] = (final.st_dev, final.st_ino) == identity
        result["wal_exists_after"], result["shm_exists_after"] = wal.exists(), shm.exists()
        if not result["database_file_identity_unchanged"]:
            result["status"] = "DATABASE_CHANGED"
        return result
    except BaseException:
        result["status"] = "FIXTURE_FAILED" if not result["synthetic_fixture_passed"] else "WORKER_FAILED"
        return result
    finally:
        candidates.clear()


def self_test():
    checks = 0
    for value in [b"01", b"ab" * 16, b"AB" * 32, b"cd" * 512]:
        assert hex_pragma(value).startswith("PRAGMA hexkey='")
        checks += 1
    for value in [b"", b"a", b"abc", b"aa' ; VACUUM; --", b"ff" * 513, "abcd"]:
        try:
            hex_pragma(value)
        except ValueError:
            checks += 1
        else:
            raise AssertionError("candidate_not_rejected")
    result = result_template()
    assert validate_result(result)
    assert not validate_result(dict(result, secret="private"))
    assert not validate_result(dict(result, keys_exported=True))
    assert not validate_result(dict(result, status="SCHEMA_READABLE"))
    assert not validate_result(dict(result, candidate_count=5))
    assert not validate_result(dict(result, schema={"Unexpected": {"secret": "private"}}))
    checks += 6
    return {"status": "passed", "checks": checks, "touches_viber": False}


def main():
    try:
        if sys.argv[1:] == ["--self-test"]:
            return self_test()
        parser = argparse.ArgumentParser()
        parser.add_argument("--bindings", required=True)
        parser.add_argument("--worker", action="store_true")
        args = parser.parse_args()
        if args.worker:
            return worker(args.bindings)
        process = subprocess.run(
            [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--worker", "--bindings", args.bindings],
            capture_output=True, close_fds=True, timeout=45,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if process.returncode != 0 or len(process.stdout) > 8192:
            raise ValueError("WORKER_OUTPUT_REJECTED")
        value = json.loads(process.stdout)
        if not validate_result(value):
            raise ValueError("WORKER_OUTPUT_REJECTED")
        return value
    except BaseException as failure:
        value = result_template()
        value["status"] = "WORKER_TIMEOUT" if isinstance(failure, subprocess.TimeoutExpired) else "WORKER_FAILED"
        return value


if __name__ == "__main__":
    print(json.dumps(main(), separators=(",", ":")), flush=True)
