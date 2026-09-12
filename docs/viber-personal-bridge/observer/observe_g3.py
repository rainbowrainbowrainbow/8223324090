"""Bounded marker-only receive experiment. No Viber UI or send operations.

The local journal is a test consumer, not the EventGenix CRM. Raw source IDs,
account paths and secret material never form part of the public report.
"""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time


CASES = ("DUP", "NEW", "PHONE", "DESKTOP", "RENAME")
MAX_WINDOW = 1000
MAX_LISTEN_SECONDS = 600
ERRORS = {
    "WORKER_FAILED", "WORKER_TIMEOUT", "PUBLIC_OUTPUT_REJECTED", "STATE_FAILED",
    "FIXTURE_FAILED", "TARGET_NOT_VERIFIED", "CANDIDATE_UNAVAILABLE", "KEY_NOT_VALIDATED",
    "DATABASE_PATH_NOT_UNIQUE", "DATABASE_PATH_REJECTED", "DATABASE_SIDECAR_UNAVAILABLE",
    "SOURCE_EPOCH_CHANGED", "SOURCE_REGRESSED", "SOURCE_VALUE_UNSUPPORTED", "SCHEMA_VARIANT",
    "WINDOW_OVERFLOW", "CARDINALITY_AMBIGUOUS", "SOURCE_QUERY_FAILED", "SOURCE_BUSY",
    "JOURNAL_FAILED", "SOURCE_EVENT_ID_CONFLICT", "SOURCE_EPOCH_OR_ACCOUNT_MISMATCH",
    "SOURCE_TRANSACTION_FAILED", "LOCAL_ACK_CHECK_FAILED", "SESSION_ALREADY_RUNNING",
    "STATE_ARGUMENTS", "STATE_UNSUPPORTED_RUNTIME", "STATE_PATH_REJECTED", "STATE_MISSING",
    "STATE_READ_FAILED", "STATE_WRITE_FAILED", "STATE_CORRUPT", "STATE_VERSION_UNSUPPORTED",
    "STATE_DPAPI_FAILED", "STATE_COLLISION", "STATE_BINDINGS_UNAVAILABLE", "STATE_SELF_TEST_FAILED",
    "STATE_JOURNAL_MISSING", "STATE_JOURNAL_CORRUPT", "STATE_JOURNAL_UNCLAIMED",
    "STATE_JOURNAL_INCOMPLETE",
    "CLEANUP_FAILED",
    "SOURCE_TARGET_CHANGED",
    "CANDIDATE_INVALID",
    "LISTENER_ARGUMENTS", "LISTENER_SPAWN_FAILED", "LISTENER_OUTPUT_INVALID",
    "LISTENER_OUTPUT_OVERFLOW", "LISTENER_INPUT_INVALID", "LISTENER_INPUT_FAILED",
    "LISTENER_STARTUP_TIMEOUT", "LISTENER_DEADLINE", "LISTENER_STOP_TIMEOUT",
    "LISTENER_EXIT_TIMEOUT", "LISTENER_CHILD_FAILED", "LISTENER_RESULT_MISSING",
    "LISTENER_PROGRESS_INVALID", "LISTENER_EMIT_FAILED", "LISTENER_REAP_FAILED",
    "LISTENER_INTERRUPTED",
}


class ObserverError(Exception):
    def __init__(self, code):
        self.code = code if code in ERRORS else "WORKER_FAILED"
        super().__init__(self.code)


def load_local(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def public_result():
    return {
        "report_version": 1, "status": "NOT_RUN", "error_code": "",
        "run_id": "", "synthetic_fixture_passed": False, "target_verified": False,
        "local_database_readable": False, "source_file_continuity_verified": False,
        "baseline_reused": False, "polls": 0, "window_event_count": 0,
        "newly_journaled": 0, "reobserved": 0, "pending_relations": 0,
        "journal_total": 0, "journal_pending": 0, "journal_acked": 0,
        "case_counts": {case: 0 for case in CASES},
        "same_chat_distinct_duplicate_events": False,
        "controlled_chat_count": 0, "controlled_contact_ref_count": 0,
        "new_marker_without_prior_local_chat_events": 0,
        "missing_number_observations": 0, "missing_token_observations": 0,
        "local_ack_simulation_performed": False, "local_ack_retry_noop": False,
        "direction_semantics_verified": False, "new_contact_globally_verified": False,
        "recipient_verified": False, "provider_delivery_verified": False,
        "messages_sent": 0, "private_text_exported": False, "keys_exported": False,
        "crm_contacted": False,
    }


def valid_public(value):
    template = public_result()
    if not isinstance(value, dict) or value.keys() != template.keys():
        return False
    for key, expected in template.items():
        if type(value[key]) is not type(expected):
            return False
        maximum = (MAX_LISTEN_SECONDS + 1) * MAX_WINDOW if key == "reobserved" else 200000
        if type(expected) is int and not 0 <= value[key] <= maximum:
            return False
    if value["report_version"] != 1:
        return False
    if value["status"] not in {"NOT_RUN", "WAITING_FOR_TEST_MARKERS", "TEST_MARKERS_OBSERVED", "FAILED"}:
        return False
    if value["error_code"] not in ERRORS | {""}:
        return False
    if type(value["run_id"]) is not str or not re.fullmatch(r"[0-9A-F]{8}|", value["run_id"]):
        return False
    counts = value["case_counts"]
    if counts.keys() != template["case_counts"].keys() or any(type(n) is not int or not 0 <= n <= MAX_WINDOW for n in counts.values()):
        return False
    for field in ["direction_semantics_verified", "new_contact_globally_verified", "recipient_verified",
                  "provider_delivery_verified", "private_text_exported", "keys_exported", "crm_contacted"]:
        if value[field]:
            return False
    if value["messages_sent"] != 0:
        return False
    if value["status"] in {"WAITING_FOR_TEST_MARKERS", "TEST_MARKERS_OBSERVED"}:
        if not all(value[k] for k in ["synthetic_fixture_passed", "target_verified", "local_database_readable", "source_file_continuity_verified"]):
            return False
    if value["status"] == "TEST_MARKERS_OBSERVED" and value["journal_total"] == 0:
        return False
    return True


def reference(secret, namespace, value):
    return "hmac:" + hmac.new(secret, (namespace + "\0" + str(value)).encode("utf-8"), hashlib.sha256).hexdigest()


class QtRows:
    def __init__(self, context, db):
        self.context, self.db = context, db

    def __call__(self, sql, parameters, column_count, row_limit):
        query = self.context.sql.QSqlQuery(self.db)
        try:
            if not query.prepare(sql):
                raise ObserverError("SOURCE_QUERY_FAILED")
            for key, value in parameters.items():
                query.bindValue(":" + key, value)
            if not query.exec():
                native = query.lastError().nativeErrorCode()
                code = int(native) & 255 if native.isdecimal() and len(native) < 10 else 0
                raise ObserverError("SOURCE_BUSY" if code in (5, 6) else "SOURCE_QUERY_FAILED")
            rows = []
            while query.next():
                if len(rows) >= row_limit:
                    raise ObserverError("WINDOW_OVERFLOW")
                rows.append(tuple(None if query.isNull(i) else query.value(i) for i in range(column_count)))
            if query.lastError().isValid():
                native = query.lastError().nativeErrorCode()
                code = int(native) & 255 if native.isdecimal() and len(native) < 10 else 0
                raise ObserverError("SOURCE_BUSY" if code in (5, 6) else "SOURCE_QUERY_FAILED")
            return rows
        finally:
            query.finish()


def source_path():
    root = (Path(os.environ["APPDATA"]) / "ViberPC").resolve(strict=True)
    found = list(root.glob("*/viber.db"))
    if len(found) != 1:
        raise ObserverError("DATABASE_PATH_NOT_UNIQUE")
    path = found[0].resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ObserverError("DATABASE_PATH_REJECTED")
    if Path(str(path) + "-wal").exists() and not Path(str(path) + "-shm").exists():
        raise ObserverError("DATABASE_SIDECAR_UNAVAILABLE")
    return path


def open_source(context, fixture, schema, path, candidates):
    for number, candidate in enumerate(candidates):
        name = "eventgenix_g3_readonly_" + str(number)
        db = context.sql.QSqlDatabase.addDatabase("QSQLITE", name)
        fixture.check_plugin_loaded(context)
        db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1000")
        db.setDatabaseName(str(path))
        query = None
        keep = False
        try:
            if not db.open():
                continue
            query = context.sql.QSqlQuery(db)
            if not query.exec(schema.hex_pragma(candidate)):
                continue
            query.finish()
            if not query.exec("PRAGMA query_only=ON"):
                continue
            query.finish()
            readable, fields, error = schema.read_expected_schema(context, query)
            if error in (5, 6):
                raise ObserverError("SOURCE_BUSY")
            if readable:
                if not all(v for table in fields.values() for v in table.values()):
                    raise ObserverError("SCHEMA_VARIANT")
                keep = True
                return db, name
        finally:
            if query is not None:
                query.finish()
            query = None
            if not keep:
                db.close()
                db = None
                context.sql.QSqlDatabase.removeDatabase(name)
    raise ObserverError("KEY_NOT_VALIDATED")


def source_identity(path):
    info = path.stat()
    return info.st_dev, info.st_ino


def lock_session(state, session_path):
    import msvcrt
    path = state.journal_path(session_path).with_name("observer.lock")
    try:
        handle = path.open("x+b")
        handle.write(b"\0")
        handle.flush()
    except FileExistsError:
        state._regular_file(path)
        handle = path.open("r+b")
    try:
        if os.fstat(handle.fileno()).st_size != 1:
            raise ObserverError("STATE_CORRUPT")
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise ObserverError("SESSION_ALREADY_RUNNING") from None
        return handle
    except BaseException:
        handle.close()
        raise


def summarize(observations, report):
    counts = Counter(row["marker"].rsplit("-", 1)[1] for row in observations)
    report["case_counts"] = {case: counts[case] for case in CASES}
    duplicates = {}
    for row in observations:
        if row["marker"].endswith("-DUP"):
            duplicates.setdefault(row["chat_id"], set()).add(row["source_event_id"])
    report["same_chat_distinct_duplicate_events"] = any(len(ids) >= 2 for ids in duplicates.values())
    report["controlled_chat_count"] = len({row["chat_id"] for row in observations})
    report["controlled_contact_ref_count"] = len({row["contact_id"] for row in observations})
    report["new_marker_without_prior_local_chat_events"] = sum(
        row["marker"].endswith("-NEW") and not row["chat_had_events_before_baseline"] for row in observations)
    report["missing_number_observations"] = sum(not row["number_present"] for row in observations)
    report["missing_token_observations"] = sum(not row["token_present"] for row in observations)


def update_journal_report(journal, report):
    snapshot = journal.snapshot()
    report["journal_total"] = snapshot["total"]
    report["journal_pending"] = snapshot["pending"]
    report["journal_acked"] = snapshot["acked"]
    report["status"] = "TEST_MARKERS_OBSERVED" if snapshot["total"] else "WAITING_FOR_TEST_MARKERS"


def provided_candidate(provider):
    """One in-memory hex candidate; the provider never selects source paths."""
    if not callable(provider):
        raise ObserverError("CANDIDATE_INVALID")
    candidate = provider()
    if type(candidate) is not bytes or not re.fullmatch(rb"(?:[0-9a-fA-F]{2}){1,512}", candidate):
        raise ObserverError("CANDIDATE_INVALID")
    return [candidate]


def worker(session_path, seconds, local_ack, progress=None, should_stop=None, redirect_stderr=True,
           enforce_process_continuity=False, candidate_provider=None):
    report = public_result()
    db = context = journal = None
    connection_name = None
    candidates = []
    rows = None
    lock_handle = None
    process_guard = None
    should_stop = should_stop or (lambda: False)
    enforce_process_continuity = enforce_process_continuity or candidate_provider is not None
    stopped = False
    if redirect_stderr:
        with open(os.devnull, "w", encoding="utf-8") as null:
            os.dup2(null.fileno(), 2)
    try:
        if should_stop():
            return report
        state_module = load_local("g3_state")
        session = state_module.load_session(session_path)
        lock_handle = lock_session(state_module, session_path)
        report["run_id"] = session["run_id"]
        markers = ["EGXG3-" + session["run_id"] + "-" + case for case in CASES]
        fixture = load_local("qt_readonly_fixture")
        schema = load_local("probe_db_schema")
        probe = load_local("probe_key_presence")
        context = fixture.initialize_qt(session["bindings_path"])
        if fixture.run_fixture(context)["status"] != "PASS":
            raise ObserverError("FIXTURE_FAILED")
        report["synthetic_fixture_passed"] = True
        if should_stop():
            return report
        if enforce_process_continuity:
            process_module = load_local("g3_process")
            process_guard = process_module.capture(probe)
        if candidate_provider is None:
            candidates, _limited, scan = schema.collect_candidates(probe)
        else:
            if not process_guard.alive():
                raise ObserverError("SOURCE_TARGET_CHANGED")
            candidates = provided_candidate(candidate_provider)
        if should_stop():
            return report
        if candidate_provider is None and (not scan["target_verified"] or scan["status"] == "target_exited"):
            raise ObserverError("TARGET_NOT_VERIFIED")
        report["target_verified"] = True
        if process_guard is not None and not process_guard.alive():
            report["target_verified"] = False
            raise ObserverError("SOURCE_TARGET_CHANGED")
        if not candidates:
            raise ObserverError("CANDIDATE_UNAVAILABLE")
        path = source_path()
        identity = source_identity(path)
        db, connection_name = open_source(context, fixture, schema, path, candidates)
        candidates.clear()
        report["local_database_readable"] = True
        if should_stop():
            return report
        rows = QtRows(context, db)
        key = session["hmac_key"]
        epoch = reference(key, "database-epoch", identity)
        account = reference(key, "local-account-directory", os.path.normcase(str(path.parent)))
        journal_module = load_local("g3_journal")
        query_module = load_local("g3_queries")
        journal_file, first_initialization = state_module.claim_journal_initialization(session_path)
        journal = journal_module.Journal(journal_file, epoch, account)
        before = journal.snapshot()
        if not first_initialization and before["baseline"] is None:
            raise ObserverError("STATE_JOURNAL_INCOMPLETE")
        report["baseline_reused"] = before["baseline"] is not None
        maximum = rows("SELECT COALESCE(MAX(EventID),0) FROM Events", {}, 1, 1)[0][0]
        if type(maximum) is not int or maximum < 0:
            raise ObserverError("SOURCE_VALUE_UNSUPPORTED")
        baseline = journal.initialize_baseline(maximum)
        deadline = time.monotonic() + seconds
        while True:
            if should_stop():
                stopped = True
                break
            if process_guard is not None and not process_guard.alive():
                report["target_verified"] = False
                raise ObserverError("SOURCE_TARGET_CHANGED")
            if enforce_process_continuity and source_path() != path:
                report["source_file_continuity_verified"] = False
                raise ObserverError("SOURCE_EPOCH_CHANGED")
            if source_identity(path) != identity:
                report["source_file_continuity_verified"] = False
                raise ObserverError("SOURCE_EPOCH_CHANGED")
            report["source_file_continuity_verified"] = True
            if not db.transaction():
                raise ObserverError("SOURCE_TRANSACTION_FAILED")
            try:
                window = query_module.scan_window(rows, baseline, markers, max_events=MAX_WINDOW)
            finally:
                if not db.rollback():
                    raise ObserverError("SOURCE_TRANSACTION_FAILED")
            if source_identity(path) != identity:
                report["source_file_continuity_verified"] = False
                raise ObserverError("SOURCE_EPOCH_CHANGED")
            if process_guard is not None and not process_guard.alive():
                report["target_verified"] = False
                raise ObserverError("SOURCE_TARGET_CHANGED")
            if enforce_process_continuity and source_path() != path:
                report["source_file_continuity_verified"] = False
                raise ObserverError("SOURCE_EPOCH_CHANGED")
            prior = journal.snapshot()
            if window["cursor"] < prior["cursor"]:
                raise ObserverError("SOURCE_REGRESSED")
            events = [{
                "source_event_id": row["source_event_id"],
                "chat_ref": reference(key, "chat", row["chat_id"]),
                "peer_ref": reference(key, "source-contact", row["contact_id"]),
                "marker": row["marker"], "direction_code": row["direction_code"],
            } for row in window["observations"]]
            applied = journal.observe_batch(events, window["cursor"])
            report["newly_journaled"] += applied["inserted"]
            report["reobserved"] += applied["existing"]
            report["polls"] += 1
            report["window_event_count"] = window["window_count"]
            report["pending_relations"] = window["pending_relations"]
            summarize(window["observations"], report)
            update_journal_report(journal, report)
            if progress is not None:
                progress(deepcopy(report))
            if should_stop():
                stopped = True
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(min(1, max(0, deadline - time.monotonic())))
        if local_ack and not stopped:
            event_ids = [event["event_id"] for event in journal.list_pending(limit=MAX_WINDOW)]
            if event_ids:
                changed = journal.ack(event_ids)
                repeat = journal.ack(event_ids)
                if changed != len(event_ids) or repeat != 0:
                    raise ObserverError("LOCAL_ACK_CHECK_FAILED")
                report["local_ack_simulation_performed"] = True
                report["local_ack_retry_noop"] = True
        if report["polls"]:
            update_journal_report(journal, report)
    except BaseException as error:
        code = getattr(error, "code", "WORKER_FAILED")
        report["status"] = "FAILED"
        fallback = "JOURNAL_FAILED" if type(error).__module__ == "g3_journal" else "WORKER_FAILED"
        report["error_code"] = code if code in ERRORS else fallback
    finally:
        candidates.clear()
        cleanup_failed = False
        if journal is not None:
            try:
                journal.close()
            except BaseException:
                cleanup_failed = True
        rows = None
        if db is not None:
            try:
                db.close()
            except BaseException:
                cleanup_failed = True
        db = None
        if context is not None and connection_name is not None:
            try:
                context.sql.QSqlDatabase.removeDatabase(connection_name)
            except BaseException:
                cleanup_failed = True
        if process_guard is not None:
            try:
                process_guard.close()
            except BaseException:
                cleanup_failed = True
        if lock_handle is not None:
            try:
                lock_handle.close()
            except BaseException:
                cleanup_failed = True
        if cleanup_failed:
            report["status"], report["error_code"] = "FAILED", "CLEANUP_FAILED"
    return report


def watch_stop_input(stream, stopped):
    """A closed control pipe or any command ends this worker; no shell input."""
    try:
        stream.readline(64)
    finally:
        stopped.set()


def start_worker_control(seconds, stream):
    """Bound only this helper if its control pipe closes while work is stuck."""
    stopped, finished = threading.Event(), threading.Event()

    def watchdog():
        deadline = time.monotonic() + 45 + seconds + 5
        stop_at = None
        while not finished.wait(0.1):
            now = time.monotonic()
            if stopped.is_set() and stop_at is None:
                stop_at = now
            if now >= deadline or stop_at is not None and now - stop_at >= 5:
                # No target PID: this exits only the current disposable worker.
                os._exit(73)

    threading.Thread(target=watch_stop_input, args=(stream, stopped), daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()
    return stopped, finished


def emit_stream(kind, report):
    if not valid_public(report):
        raise ObserverError("PUBLIC_OUTPUT_REJECTED")
    print(json.dumps({"kind": kind, "result": report}, separators=(",", ":")), flush=True)


def self_test():
    result = public_result()
    assert valid_public(result)
    for modified in [dict(result, status="TEST_MARKERS_OBSERVED"), dict(result, key="private"),
                     dict(result, recipient_verified=True), dict(result, crm_contacted=True),
                     dict(result, run_id="private"), dict(result, case_counts={"secret": "private"}),
                     dict(result, messages_sent=1)]:
        assert not valid_public(modified)
    a = reference(b"a" * 32, "chat", 1)
    assert a == reference(b"a" * 32, "chat", 1)
    assert a != reference(b"a" * 32, "chat", 2)
    assert a != reference(b"b" * 32, "chat", 1)
    return {"status": "passed", "checks": 11, "touches_viber": False}


def main():
    args = None
    try:
        if sys.argv[1:] == ["--self-test"]:
            return self_test()
        parser = argparse.ArgumentParser()
        parser.add_argument("--prepare", action="store_true")
        parser.add_argument("--bindings")
        parser.add_argument("--session")
        parser.add_argument("--seconds", type=int)
        parser.add_argument("--listen", action="store_true")
        parser.add_argument("--local-ack-test", action="store_true")
        parser.add_argument("--worker", action="store_true")
        args = parser.parse_args()
        if args.seconds is None:
            args.seconds = MAX_LISTEN_SECONDS if args.listen else 5
        if (args.listen and (not 1 <= args.seconds <= MAX_LISTEN_SECONDS or args.local_ack_test)
                or not args.listen and not 0 <= args.seconds <= 45):
            raise ObserverError("STATE_ARGUMENTS")
        if args.prepare:
            if not args.bindings or args.session or args.worker or args.listen:
                raise ObserverError("STATE_FAILED")
            state = load_local("g3_state")
            path = state.create_session(args.bindings)
            session = state.load_session(path)
            return {"status": "PREPARED", "session_path": str(path), "run_id": session["run_id"],
                    "markers": ["EGXG3-" + session["run_id"] + "-" + case for case in CASES],
                    "viber_accessed": False}
        if not args.session or args.bindings:
            raise ObserverError("STATE_FAILED")
        if args.worker:
            if args.listen:
                stopped, finished = start_worker_control(args.seconds, sys.stdin)
                try:
                    report = worker(args.session, args.seconds, False,
                                    progress=lambda report: emit_stream("progress", report),
                                    should_stop=stopped.is_set,
                                    enforce_process_continuity=True)
                    emit_stream("finished", report)
                finally:
                    finished.set()
                return None
            return worker(args.session, args.seconds, args.local_ack_test)
        command = [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--worker",
                   "--session", args.session, "--seconds", str(args.seconds)]
        if args.local_ack_test:
            command.append("--local-ack-test")
        if args.listen:
            command.append("--listen")
            listener = load_local("g3_listener")
            listener.supervise(command, args.seconds, valid_public)
            return None
        child = subprocess.run(command, capture_output=True, close_fds=True, timeout=45 + args.seconds,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if child.returncode != 0 or len(child.stdout) > 8192:
            raise ObserverError("PUBLIC_OUTPUT_REJECTED")
        value = json.loads(child.stdout)
        if not valid_public(value):
            raise ObserverError("PUBLIC_OUTPUT_REJECTED")
        return value
    except BaseException as error:
        result = public_result()
        result["status"] = "FAILED"
        code = "WORKER_TIMEOUT" if isinstance(error, subprocess.TimeoutExpired) else getattr(error, "code", "WORKER_FAILED")
        result["error_code"] = code if code in ERRORS else "WORKER_FAILED"
        if args is not None and args.listen:
            emit_stream("finished", result)
            return None
        return result


if __name__ == "__main__":
    final_result = main()
    if final_result is not None:
        print(json.dumps(final_result, separators=(",", ":")), flush=True)
