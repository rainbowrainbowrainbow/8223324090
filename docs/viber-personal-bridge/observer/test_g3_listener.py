"""Synthetic owned subprocesses only: no Qt, Viber, account files or network."""

from __future__ import annotations

import io
import json
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

import g3_listener as listener
from observe_g3 import public_result, valid_public


class ControlledInput:
    def __init__(self, value=""):
        self.value = value
        self.ready = threading.Event()

    def readline(self, _limit):
        self.ready.wait()
        return self.value


def success_result(polls=1):
    result = public_result()
    result.update(status="WAITING_FOR_TEST_MARKERS", run_id="A1B2C3D4", polls=polls,
                  synthetic_fixture_passed=True, target_verified=True,
                  local_database_readable=True, source_file_continuity_verified=True)
    return result


def child_code(body, result=None):
    encoded = json.dumps(result if result is not None else success_result())
    return ("import json, sys, time\n"
            f"r = json.loads({encoded!r})\n"
            "def send(kind, result=None):\n"
            "    print(json.dumps({'kind': kind, 'result': r if result is None else result}), flush=True)\n"
            + body)


class ListenerTests(unittest.TestCase):
    def setUp(self):
        self.processes = []
        self.inputs = []
        self.records = []
        real_popen = subprocess.Popen

        def tracked_popen(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            self.processes.append(process)
            self.assertIs(kwargs["stderr"], subprocess.DEVNULL)
            self.assertNotIn("shell", kwargs)
            return process

        self.patches = [
            patch.object(listener.subprocess, "Popen", side_effect=tracked_popen),
            patch.object(listener, "CLEANUP_SECONDS", 0.7),
            patch.object(listener, "REAP_SECONDS", 0.3),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for stream in self.inputs:
            stream.ready.set()
        for item in reversed(self.patches):
            item.stop()
        for process in self.processes:
            self.assertIsNotNone(process.poll(), "supervisor left its direct child running")
            self.assertTrue(process.stdin.closed)
            self.assertTrue(process.stdout.closed)

    def controlled_input(self, value=""):
        stream = ControlledInput(value)
        self.inputs.append(stream)
        return stream

    def run_child(self, body, *, result=None, input_stream=None, emit=None, **kwargs):
        if input_stream is None:
            input_stream = self.controlled_input()
        options = {"startup_timeout": 1.0, "heartbeat_interval": 0.04,
                   "receive_stale_after": 0.10}
        options.update(kwargs)
        return listener.supervise(
            [sys.executable, "-I", "-B", "-u", "-c", child_code(body, result)],
            1, valid_public, emit=self.records.append if emit is None else emit,
            input_stream=input_stream, **options,
        )

    def assert_failure(self, code, body, **kwargs):
        with self.assertRaises(listener.ListenerError) as raised:
            self.run_child(body, **kwargs)
        self.assertEqual(raised.exception.code, code)
        self.assertEqual(str(raised.exception), code)

    def test_valid_progress_and_final_are_returned_once(self):
        result = self.run_child("send('progress')\ntime.sleep(0.12)\nsend('finished')\n")
        self.assertEqual(result, success_result())
        self.assertEqual(sum(item["kind"] == "progress" for item in self.records), 1)
        self.assertEqual(sum(item["kind"] == "finished" for item in self.records), 1)
        self.assertEqual(self.records[-1], {"kind": "finished", "result": result})
        heartbeats = [item for item in self.records if item["kind"] == "heartbeat"]
        self.assertTrue(heartbeats)
        for item in heartbeats:
            self.assertFalse(item["inbound_verified"])
            self.assertNotIn("receive_healthy", item)
            if item["last_progress_age_ms"] is None:
                self.assertFalse(item["source_poll_healthy"])

    def test_final_failure_without_progress_never_claims_source_health(self):
        result = public_result()
        result.update(status="FAILED", error_code="CANDIDATE_UNAVAILABLE")
        returned = self.run_child("time.sleep(0.10)\nsend('finished')\n", result=result)
        self.assertEqual(returned, result)
        self.assertFalse(any(item.get("source_poll_healthy") for item in self.records))

    def test_malformed_json_is_rejected_without_raw_output(self):
        self.assert_failure("LISTENER_OUTPUT_INVALID",
                            "print('not-json PRIVATE-SYNTHETIC', flush=True)\ntime.sleep(60)\n")
        self.assertNotIn("PRIVATE-SYNTHETIC", json.dumps(self.records))

    def test_duplicate_json_member_is_rejected(self):
        self.assert_failure("LISTENER_OUTPUT_INVALID",
                            "print('{\"kind\":\"progress\",\"kind\":\"finished\",\"result\":{}}', flush=True)\n")

    def test_forbidden_public_result_field_is_rejected(self):
        self.assert_failure("LISTENER_OUTPUT_INVALID",
                            "r['private_text_exported'] = True\nsend('progress')\ntime.sleep(60)\n")

    def test_oversized_jsonl_line_is_rejected(self):
        self.assert_failure("LISTENER_OUTPUT_OVERFLOW",
                            "print('x' * 8192, flush=True)\ntime.sleep(60)\n")

    def test_partial_line_at_eof_is_rejected(self):
        self.assert_failure("LISTENER_OUTPUT_INVALID",
                            "sys.stdout.write(json.dumps({'kind':'finished','result':r}))\nsys.stdout.flush()\n")

    def test_stdout_stall_hits_startup_timeout_without_health(self):
        self.assert_failure("LISTENER_STARTUP_TIMEOUT", "time.sleep(60)\n", startup_timeout=0.4)
        self.assertGreater(len(self.records), 1)
        self.assertTrue(any(item["worker_alive"] for item in self.records))
        self.assertFalse(any(item["source_poll_healthy"] for item in self.records))

    def test_heartbeat_source_poll_expires_while_worker_remains_alive(self):
        self.run_child("send('progress')\ntime.sleep(0.4)\nsend('finished')\n")
        heartbeats = [item for item in self.records if item["kind"] == "heartbeat"]
        healthy = [item for item in heartbeats if item["source_poll_healthy"]]
        stale = [item for item in heartbeats if item["worker_alive"]
                 and item["last_progress_age_ms"] is not None
                 and item["last_progress_age_ms"] > 100 and not item["source_poll_healthy"]]
        self.assertTrue(healthy)
        self.assertTrue(stale)
        self.assertTrue(all(item["inbound_verified"] is False for item in heartbeats))

    def stop_after_progress(self, value):
        stream = self.controlled_input(value)

        def emit(item):
            self.records.append(item)
            if item["kind"] == "progress":
                stream.ready.set()

        body = ("send('progress')\n"
                "line = sys.stdin.readline()\n"
                "assert line == 'stop\\n'\n"
                "time.sleep(0.06)\n"
                "send('finished')\n")
        return body, stream, emit

    def test_operator_stop_is_forwarded_exactly_and_reaped(self):
        body, stream, emit = self.stop_after_progress("stop\n")
        self.run_child(body, input_stream=stream, emit=emit)
        self.assertTrue(any(item.get("stop_requested") for item in self.records))
        self.assertFalse(any(item.get("source_poll_healthy") for item in self.records
                             if item.get("stop_requested")))

    def test_operator_eof_is_forwarded_as_stop_and_reaped(self):
        body, stream, emit = self.stop_after_progress("")
        self.run_child(body, input_stream=stream, emit=emit)
        self.assertTrue(any(item.get("stop_requested") for item in self.records))

    def test_invalid_operator_input_stops_child_with_fixed_error(self):
        body, stream, emit = self.stop_after_progress("other\n")
        self.assert_failure("LISTENER_INPUT_INVALID", body, input_stream=stream, emit=emit)
        self.assertFalse(any(item["kind"] == "finished" for item in self.records))

    def test_ignored_stop_is_terminated_at_stop_deadline(self):
        stream = self.controlled_input("stop\n")

        def emit(item):
            self.records.append(item)
            if item["kind"] == "progress":
                stream.ready.set()

        self.assert_failure("LISTENER_STOP_TIMEOUT", "send('progress')\ntime.sleep(60)\n",
                            input_stream=stream, emit=emit)

    def test_progress_then_stall_hits_absolute_deadline(self):
        self.assert_failure("LISTENER_DEADLINE", "send('progress')\ntime.sleep(60)\n",
                            startup_timeout=0.5)
        self.assertFalse(any(item["kind"] == "finished" for item in self.records))

    def test_final_frame_does_not_bypass_exit_deadline(self):
        self.assert_failure("LISTENER_EXIT_TIMEOUT", "send('finished')\ntime.sleep(60)\n")
        self.assertFalse(any(item["kind"] == "finished" for item in self.records))

    def test_exit_without_final_is_rejected(self):
        self.assert_failure("LISTENER_RESULT_MISSING", "pass\n")

    def test_failed_exit_cannot_promote_a_finished_packet(self):
        self.assert_failure("LISTENER_CHILD_FAILED", "send('finished')\nsys.exit(3)\n")

    def test_replayed_poll_counter_cannot_refresh_health(self):
        self.assert_failure("LISTENER_PROGRESS_INVALID",
                            "send('progress')\ntime.sleep(0.05)\nsend('progress')\ntime.sleep(60)\n")

    def test_progress_flood_is_bounded_and_rejected(self):
        self.assert_failure("LISTENER_OUTPUT_OVERFLOW",
                            "for n in range(120):\n    r['polls'] = n + 1\n    send('progress')\ntime.sleep(60)\n")
        self.assertLess(len(self.records), 20)

    def test_unchanged_progress_is_throttled(self):
        self.run_child("send('progress')\ntime.sleep(0.1)\nr['polls']=2\n"
                       "send('progress')\ntime.sleep(0.1)\nsend('finished')\n")
        self.assertEqual(sum(item["kind"] == "progress" for item in self.records), 1)
        self.assertEqual(self.records[-1]["result"]["polls"], 2)

    def test_keyboard_interrupt_reaps_owned_child(self):
        def interrupted(_item):
            raise KeyboardInterrupt()

        self.assert_failure("LISTENER_INTERRUPTED", "time.sleep(60)\n", emit=interrupted)

    def test_emitter_failure_reaps_owned_child(self):
        def failed(_item):
            raise RuntimeError("synthetic callback detail must stay private")

        self.assert_failure("LISTENER_EMIT_FAILED", "time.sleep(60)\n", emit=failed)

    def test_invalid_arguments_do_not_spawn_child(self):
        for seconds in (0, 601, True, "1"):
            with self.subTest(seconds=seconds), self.assertRaises(listener.ListenerError) as raised:
                listener.supervise([sys.executable], seconds, valid_public, input_stream=io.StringIO(""))
            self.assertEqual(raised.exception.code, "LISTENER_ARGUMENTS")
        self.assertFalse(self.processes)


if __name__ == "__main__":
    unittest.main()
