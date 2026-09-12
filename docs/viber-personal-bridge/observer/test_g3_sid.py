"""Synthetic provider/launcher checks; no real SID, Viber, RAM, or session reads."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import observe_g3
import observe_g3_sid as sid
import test_g3_lifecycle as lifecycle


class CandidateProviderTests(unittest.TestCase):
    def setUp(self):
        self.fixture = lifecycle.WorkerLifecycleTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.schema.collect_candidates.side_effect = AssertionError("RAM scan must not run")

    def test_custom_provider_runs_once_after_fixture_and_guard_across_polls(self):
        def candidate():
            self.fixture.fixture.run_fixture.assert_called_once()
            self.fixture.process_module.capture.assert_called_once()
            return b"AB" * 32

        provider = Mock(side_effect=candidate)
        result = self.fixture.run_worker(3, candidate_provider=provider,
                                         actions={1: self.fixture.add_duplicates})
        self.assertEqual(result["status"], "TEST_MARKERS_OBSERVED")
        self.assertEqual(result["polls"], 4)
        self.assertEqual(result["journal_pending"], 2)
        provider.assert_called_once_with()
        self.fixture.schema.collect_candidates.assert_not_called()
        self.fixture.process_module.capture.assert_called_once()
        self.fixture.process_guard.close.assert_called_once()
        self.assertEqual(len(self.fixture.sources), 1)
        self.fixture.assert_closed_once()

    def test_provider_cannot_return_multiple_malformed_or_non_bytes_candidates(self):
        for value in (b"", b"A", b"GG", b"AA" * 513, "AA", [b"AA"], bytearray(b"AA")):
            with self.subTest(kind=type(value).__name__, length=len(value)):
                provider = Mock(return_value=value)
                result = self.fixture.run_worker(candidate_provider=provider)
                self.assertEqual(result["error_code"], "CANDIDATE_INVALID")
                self.assertEqual(result["status"], "FAILED")
                provider.assert_called_once()
                self.assertTrue(observe_g3.valid_public(result))
        self.fixture.schema.collect_candidates.assert_not_called()
        self.fixture.state.claim_journal_initialization.assert_not_called()
        self.assertEqual(self.fixture.sources, [])
        self.assertEqual(self.fixture.process_guard.close.call_count, 7)

    def test_provider_error_is_redacted_and_never_falls_back_to_ram(self):
        provider = Mock(side_effect=RuntimeError("synthetic-secret-that-must-not-escape"))
        result = self.fixture.run_worker(candidate_provider=provider)
        self.assertEqual(result["error_code"], "WORKER_FAILED")
        self.assertNotIn("synthetic-secret", json.dumps(result))
        provider.assert_called_once()
        self.fixture.schema.collect_candidates.assert_not_called()
        self.fixture.process_guard.close.assert_called_once()
        self.assertEqual(self.fixture.sources, [])

    def test_missing_or_corrupt_state_is_not_recreated_and_provider_never_runs(self):
        provider = Mock(return_value=b"AA")
        for code in ("STATE_MISSING", "STATE_CORRUPT"):
            with self.subTest(code=code):
                self.fixture.state.load_session.side_effect = observe_g3.ObserverError(code)
                result = self.fixture.run_worker(candidate_provider=provider)
                self.assertEqual(result["error_code"], code)
        provider.assert_not_called()
        self.fixture.state.claim_journal_initialization.assert_not_called()
        self.fixture.fixture.initialize_qt.assert_not_called()
        self.fixture.process_module.capture.assert_not_called()
        self.fixture.schema.collect_candidates.assert_not_called()
        self.assertFalse(self.fixture.journal_file.exists())
        self.assertEqual(self.fixture.locks, [])

    def test_guard_failure_prevents_provider_and_source_access(self):
        self.fixture.process_module.capture.side_effect = observe_g3.ObserverError("TARGET_NOT_VERIFIED")
        provider = Mock(return_value=b"AA")
        result = self.fixture.run_worker(candidate_provider=provider)
        self.assertEqual(result["error_code"], "TARGET_NOT_VERIFIED")
        provider.assert_not_called()
        self.fixture.schema.collect_candidates.assert_not_called()
        self.assertEqual(self.fixture.sources, [])
        self.fixture.locks[0].close.assert_called_once()

    def test_custom_provider_enforces_path_continuity_without_explicit_flag(self):
        current = self.fixture.source

        def progress(report):
            nonlocal current
            if report["journal_pending"] == 2:
                current = self.fixture.directory / "synthetic-other.sqlite"

        result = self.fixture.run_worker(30, local_ack=True, progress=progress,
                                         actions={1: self.fixture.add_duplicates},
                                         source_path=lambda: current, candidate_provider=lambda: b"AA")
        self.assertEqual(result["error_code"], "SOURCE_EPOCH_CHANGED")
        self.assertFalse(result["local_ack_simulation_performed"])
        self.assertEqual(self.fixture.persisted()[0]["pending"], 2)
        self.assertEqual(len(self.fixture.sources), 1)
        self.fixture.schema.collect_candidates.assert_not_called()
        self.fixture.process_guard.close.assert_called_once()


class SidLauncherTests(unittest.TestCase):
    def response(self):
        return sid.envelope(observe_g3, observe_g3.public_result())

    def test_sid_provider_derives_once_from_only_fixed_local_functions(self):
        recovery = SimpleNamespace(static_prefix=Mock(return_value=b"TEST"),
                                   account_path=Mock(return_value=Path("synthetic-unused.sqlite")),
                                   current_sid=Mock(return_value=b"S-1-5-21-42"),
                                   derive=Mock(return_value=b"AA"))
        with patch.object(sid, "local_module", return_value=recovery) as load:
            self.assertEqual(sid.sid_candidate(), b"AA")
        load.assert_called_once_with("recover_sid_key")
        recovery.account_path.assert_called_once_with()
        recovery.static_prefix.assert_called_once_with()
        recovery.current_sid.assert_called_once_with()
        recovery.derive.assert_called_once_with(b"TEST", b"S-1-5-21-42")

    def test_supervisor_uses_hidden_isolated_timed_child_and_validates_envelope(self):
        expected = self.response()
        runner = Mock(return_value=SimpleNamespace(returncode=0, stdout=json.dumps(expected).encode()))
        self.assertEqual(sid.supervise(observe_g3, "synthetic-session", 3, True, runner), expected)
        command = runner.call_args.args[0]
        self.assertEqual(command[:3], [sys.executable, "-I", "-B"])
        self.assertIn("--worker", command)
        self.assertIn("--local-ack-test", command)
        self.assertNotIn("--prepare", command)
        self.assertEqual(runner.call_args.kwargs["timeout"], 48)
        self.assertEqual(runner.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(runner.call_args.kwargs["stderr"], subprocess.DEVNULL)
        if os.name == "nt":
            self.assertEqual(runner.call_args.kwargs["creationflags"], subprocess.CREATE_NO_WINDOW)

    def test_bad_child_output_cannot_escape_as_raw_text_or_wrong_bootstrap(self):
        valid = self.response()
        duplicate = json.dumps(valid).replace('"bootstrap": "windows_sid"',
                                              '"bootstrap": "windows_sid", "bootstrap": "windows_sid"').encode()
        bad = [b"synthetic-private-text", b"x" * (sid.MAX_OUTPUT + 1), duplicate,
               json.dumps(dict(valid, bootstrap="other")).encode(),
               json.dumps(dict(valid, secret="synthetic-private-text")).encode(),
               json.dumps({"bootstrap": sid.BOOTSTRAP, "result": {"status": "PASS"}}).encode()]
        for output in bad:
            with self.subTest(length=len(output)):
                runner = Mock(return_value=SimpleNamespace(returncode=0, stdout=output))
                result = sid.supervise(observe_g3, "synthetic-session", 0, False, runner)
                self.assertEqual(result["result"]["error_code"], "PUBLIC_OUTPUT_REJECTED")
                self.assertTrue(sid.valid_envelope(observe_g3, result))
                self.assertNotIn("synthetic-private-text", json.dumps(result))

    def test_timeout_is_fixed_failure_without_partial_output(self):
        runner = Mock(side_effect=subprocess.TimeoutExpired(["synthetic"], 45, output=b"synthetic-private-text"))
        result = sid.supervise(observe_g3, "synthetic-session", 0, False, runner)
        self.assertEqual(result["result"]["error_code"], "WORKER_TIMEOUT")
        self.assertNotIn("synthetic-private-text", json.dumps(result))

    def test_default_worker_is_one_snapshot_and_forwards_only_sid_provider(self):
        with patch.object(observe_g3, "worker", return_value=observe_g3.public_result()) as worker:
            result = sid.main(["--worker", "--session", "synthetic-session"], observer=observe_g3)
        worker.assert_called_once_with("synthetic-session", 0, False, candidate_provider=sid.sid_candidate)
        self.assertTrue(sid.valid_envelope(observe_g3, result))

    def test_auto_session_resolves_only_canonical_single_directory(self):
        state = SimpleNamespace(
            DIRECTORY_PATTERN=re.compile(r"g3-[0-9A-F]{8}\Z"),
            StateError=type("SyntheticStateError", (Exception,), {}),
            _base_directory=Mock(),
            _existing_directory=Mock(),
        )
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            session = base / "g3-0B038E78"
            session.mkdir()
            state._base_directory.return_value = base
            state._existing_directory.return_value = session
            with patch.object(sid, "local_module", return_value=state):
                self.assertEqual(sid.find_single_session(), str(session))
        state._existing_directory.assert_called_once_with(session)

    def test_auto_session_is_resolved_before_supervisor(self):
        with (patch.object(sid, "find_single_session", return_value="canonical-session") as find,
              patch.object(sid, "supervise", return_value=self.response()) as supervisor):
            result = sid.main(["--auto-session", "--seconds", "3"], observer=observe_g3)
        find.assert_called_once_with()
        supervisor.assert_called_once_with(observe_g3, "canonical-session", 3, False)
        self.assertTrue(sid.valid_envelope(observe_g3, result))

    def test_auto_session_cannot_be_combined_or_used_by_worker(self):
        with patch.object(sid, "supervise") as supervisor:
            for argv in (["--session", "synthetic", "--auto-session"],
                         ["--worker", "--auto-session"]):
                with self.subTest(argv=argv):
                    result = sid.main(argv, observer=observe_g3)
                    self.assertEqual(result["result"]["error_code"], "STATE_ARGUMENTS")
            supervisor.assert_not_called()

    def test_no_prepare_missing_session_or_out_of_bounds_seconds_can_start_child(self):
        with patch.object(sid, "supervise") as supervisor:
            for argv in ([], ["--prepare"], ["--session", "synthetic", "--seconds", "-1"],
                         ["--session", "synthetic", "--seconds", "46"]):
                with self.subTest(argv=argv):
                    result = sid.main(argv, observer=observe_g3)
                    self.assertEqual(result["result"]["error_code"], "STATE_ARGUMENTS")
            supervisor.assert_not_called()

    def test_isolated_cli_rejects_prepare_before_loading_any_session(self):
        command = [sys.executable, "-I", "-B", str(Path(sid.__file__).resolve()),
                   "--session", "synthetic-unused-session", "--prepare"]
        child = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=5, close_fds=True,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        self.assertEqual(child.returncode, 0)
        self.assertEqual(child.stderr, b"")
        result = json.loads(child.stdout)
        self.assertTrue(sid.valid_envelope(observe_g3, result))
        self.assertEqual(result["result"]["error_code"], "STATE_ARGUMENTS")


if __name__ == "__main__":
    unittest.main()
