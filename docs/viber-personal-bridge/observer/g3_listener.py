"""Bounded JSONL supervision of one locally constructed G3 worker command.

No Viber access, process-name termination, respawn, files or network clients.
The input reader is a daemon: this supervisor is intended to run once per CLI
process. The worker additionally needs its own deadline for abrupt parent death.
"""

from __future__ import annotations

import json
import math
import os
import queue
import subprocess
import sys
import threading
import time
from typing import Callable


MAX_LINE_BYTES = 8192
MAX_PENDING_LINES = 16
CLEANUP_SECONDS = 5.0
REAP_SECONDS = 1.0
PROGRESS_EMIT_INTERVAL = 5.0
ERROR_CODES = frozenset({
    "LISTENER_ARGUMENTS", "LISTENER_SPAWN_FAILED", "LISTENER_OUTPUT_INVALID",
    "LISTENER_OUTPUT_OVERFLOW", "LISTENER_INPUT_INVALID", "LISTENER_INPUT_FAILED",
    "LISTENER_STARTUP_TIMEOUT", "LISTENER_DEADLINE", "LISTENER_STOP_TIMEOUT",
    "LISTENER_EXIT_TIMEOUT", "LISTENER_CHILD_FAILED", "LISTENER_RESULT_MISSING",
    "LISTENER_PROGRESS_INVALID", "LISTENER_EMIT_FAILED", "LISTENER_REAP_FAILED",
    "LISTENER_INTERRUPTED",
})


class ListenerError(Exception):
    def __init__(self, code: str):
        self.code = code if code in ERROR_CODES else "LISTENER_OUTPUT_INVALID"
        super().__init__(self.code)


def emit_json(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def _emit(emit: Callable, value: dict) -> None:
    try:
        emit(value)
    except KeyboardInterrupt:
        raise
    except Exception:
        raise ListenerError("LISTENER_EMIT_FAILED") from None


def _unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("duplicate member")
        result[name] = value
    return result


def _invalid_constant(_value):
    raise ValueError("non-JSON number")


def _packet(line: bytes, validate_result: Callable) -> dict:
    try:
        packet = json.loads(line.decode("utf-8"), object_pairs_hook=_unique_object,
                            parse_constant=_invalid_constant)
        if (type(packet) is not dict or packet.keys() != {"kind", "result"}
                or type(packet["kind"]) is not str
                or packet["kind"] not in {"progress", "finished"}
                or type(packet["result"]) is not dict
                or validate_result(packet["result"]) is not True):
            raise ValueError("packet rejected")
        return packet
    except Exception:
        raise ListenerError("LISTENER_OUTPUT_INVALID") from None


def _meaningful(result: dict) -> str:
    fields = (
        "status", "error_code", "journal_total", "journal_pending", "journal_acked",
        "case_counts", "pending_relations", "same_chat_distinct_duplicate_events",
        "controlled_chat_count", "controlled_contact_ref_count",
        "new_marker_without_prior_local_chat_events", "missing_number_observations",
        "missing_token_observations", "local_ack_simulation_performed", "local_ack_retry_noop",
    )
    return json.dumps({key: result.get(key) for key in fields}, sort_keys=True, separators=(",", ":"))


def _reap_owned(process) -> None:
    """Only act on the exact Popen child handle; never search for processes."""
    try:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=REAP_SECONDS / 2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=REAP_SECONDS / 2)
        else:
            process.wait(timeout=REAP_SECONDS)
    except Exception:
        raise ListenerError("LISTENER_REAP_FAILED") from None


def supervise(command: list[str], seconds: int, validate_result: Callable,
              emit: Callable = emit_json, input_stream=None, startup_timeout: float = 45,
              heartbeat_interval: float = 5, receive_stale_after: float = 3) -> dict:
    """Return one validated final result, emitting compact liveness records.

    source_poll_healthy means recent successful SQL progress, never incoming
    message health. validate_result and emit are trusted, nonblocking callbacks.
    Child stdout is bounded JSONL; parent input accepts only stop newline or EOF.
    """
    timings = (startup_timeout, heartbeat_interval, receive_stale_after)
    if (type(command) is not list or not command or len(command) > 32
            or any(type(part) is not str or not part or len(part) > 32768 or "\0" in part for part in command)
            or type(seconds) is not int or not 1 <= seconds <= 600
            or not callable(validate_result) or not callable(emit)
            or any(type(value) not in (int, float) or not math.isfinite(value) or value <= 0 for value in timings)
            or startup_timeout > 45 or heartbeat_interval > 60 or receive_stale_after > 60):
        raise ListenerError("LISTENER_ARGUMENTS")
    if input_stream is None:
        input_stream = sys.stdin

    started = time.monotonic()
    try:
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, close_fds=True, bufsize=0,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except Exception:
        raise ListenerError("LISTENER_SPAWN_FAILED") from None

    outputs: queue.Queue = queue.Queue(maxsize=MAX_PENDING_LINES)
    output_done = threading.Event()
    output_error = [None]
    input_ready = threading.Event()
    input_error = [None]
    cancel_input = threading.Event()

    def read_output():
        try:
            while True:
                line = process.stdout.readline(MAX_LINE_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_LINE_BYTES:
                    output_error[0] = "LISTENER_OUTPUT_OVERFLOW"
                    break
                if not line.endswith(b"\n"):
                    output_error[0] = "LISTENER_OUTPUT_INVALID"
                    break
                try:
                    outputs.put_nowait(line)
                except queue.Full:
                    output_error[0] = "LISTENER_OUTPUT_OVERFLOW"
                    break
        except Exception:
            output_error[0] = "LISTENER_OUTPUT_INVALID"
        finally:
            output_done.set()

    def read_input():
        try:
            line = input_stream.readline(7)
            if cancel_input.is_set():
                return
            if line not in ("stop\n", "", b"stop\n", b""):
                input_error[0] = "LISTENER_INPUT_INVALID"
        except Exception:
            if cancel_input.is_set():
                return
            input_error[0] = "LISTENER_INPUT_FAILED"
        input_ready.set()

    output_thread = threading.Thread(target=read_output, name="g3-jsonl-output", daemon=True)
    input_thread = threading.Thread(target=read_input, name="g3-operator-input", daemon=True)
    stop_requested = False
    stop_deadline = None
    finished_deadline = None
    last_progress = None
    last_poll = 0
    progress_count = 0
    last_emitted_signature = None
    last_progress_emit = None
    final_result = None
    next_heartbeat = started
    # Reserve the final second for terminate/kill/wait within the five-second
    # cleanup allowance. A user stop gets the same total cleanup allowance.
    cleanup_wait = max(0.0, CLEANUP_SECONDS - REAP_SECONDS)
    hard_abort = started + startup_timeout + seconds + cleanup_wait

    try:
        output_thread.start()
        input_thread.start()
        while True:
            now = time.monotonic()
            if output_error[0]:
                raise ListenerError(output_error[0])
            if input_ready.is_set() and not stop_requested:
                stop_requested = True
                stop_deadline = now + cleanup_wait
                try:
                    if process.poll() is None:
                        process.stdin.write(b"stop\n")
                        process.stdin.flush()
                    process.stdin.close()
                except (BrokenPipeError, OSError):
                    pass

            for _ in range(MAX_PENDING_LINES):
                try:
                    line = outputs.get_nowait()
                except queue.Empty:
                    break
                packet = _packet(line, validate_result)
                if final_result is not None:
                    raise ListenerError("LISTENER_OUTPUT_INVALID")
                result = packet["result"]
                if packet["kind"] == "finished":
                    final_result = result
                    finished_deadline = time.monotonic() + cleanup_wait
                    continue
                proofs = ("synthetic_fixture_passed", "target_verified",
                          "local_database_readable", "source_file_continuity_verified")
                poll = result.get("polls")
                if (result.get("status") not in {"WAITING_FOR_TEST_MARKERS", "TEST_MARKERS_OBSERVED"}
                        or result.get("error_code") != ""
                        or type(poll) is not int or poll <= last_poll
                        or any(result.get(field) is not True for field in proofs)):
                    raise ListenerError("LISTENER_PROGRESS_INVALID")
                progress_count += 1
                if progress_count > seconds + 2:
                    raise ListenerError("LISTENER_OUTPUT_OVERFLOW")
                last_poll = poll
                last_progress = time.monotonic()
                signature = _meaningful(result)
                if (last_progress_emit is None or
                        (signature != last_emitted_signature
                         and last_progress - last_progress_emit >= PROGRESS_EMIT_INTERVAL)):
                    _emit(emit, packet)
                    last_progress_emit = last_progress
                    last_emitted_signature = signature

            now = time.monotonic()
            alive = process.poll() is None
            if now >= next_heartbeat:
                age_ms = None if last_progress is None else max(0, int((now - last_progress) * 1000))
                _emit(emit, {
                    "kind": "heartbeat", "worker_alive": alive,
                    "source_poll_healthy": bool(alive and last_progress is not None
                                                and now - last_progress <= receive_stale_after
                                                and not stop_requested and final_result is None),
                    "inbound_verified": False, "last_progress_age_ms": age_ms,
                    "stop_requested": stop_requested,
                })
                next_heartbeat = now + heartbeat_interval
            if not alive and output_done.is_set() and outputs.empty():
                if input_error[0]:
                    raise ListenerError(input_error[0])
                if process.returncode != 0:
                    raise ListenerError("LISTENER_CHILD_FAILED")
                if final_result is None:
                    raise ListenerError("LISTENER_RESULT_MISSING")
                _reap_owned(process)
                _emit(emit, {"kind": "finished", "result": final_result})
                return final_result
            if output_done.is_set() and outputs.empty() and final_result is None:
                raise ListenerError("LISTENER_RESULT_MISSING")
            if stop_deadline is not None and now >= stop_deadline:
                raise ListenerError(input_error[0] or "LISTENER_STOP_TIMEOUT")
            if finished_deadline is not None and now >= finished_deadline:
                raise ListenerError("LISTENER_EXIT_TIMEOUT")
            if now >= hard_abort:
                raise ListenerError("LISTENER_DEADLINE")
            if last_progress is None and final_result is None and not stop_requested and now - started >= startup_timeout:
                raise ListenerError("LISTENER_STARTUP_TIMEOUT")
            time.sleep(0.02)
    except KeyboardInterrupt:
        raise ListenerError("LISTENER_INTERRUPTED") from None
    finally:
        cancel_input.set()
        try:
            _reap_owned(process)
        finally:
            if output_thread.ident is not None:
                output_thread.join(timeout=0.1)
            for stream in (process.stdin, process.stdout):
                try:
                    stream.close()
                except Exception:
                    pass
