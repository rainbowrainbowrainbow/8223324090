from pathlib import Path
import json
import tempfile
import unittest
from uuid import UUID
from unittest.mock import patch

import run_p1_daemon


class RunP1DaemonTests(unittest.TestCase):
    def test_load_config_requires_absolute_state_path(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "connector.json"
            config.write_text(json.dumps({
                "crm_base_url": "https://crm.example",
                "bridge_id": "10000000-0000-4000-8000-000000000001",
                "account_id": "10000000-0000-4000-8000-000000000002",
                "account_epoch": 1,
                "business_context": "event_genix",
                "token": "x" * 32,
                "state_path": "bridge.sqlite",
            }), encoding="utf-8")
            with self.assertRaisesRegex(run_p1_daemon.LauncherError, "STATE_PATH_INVALID"):
                run_p1_daemon._load_config(config)

    def test_once_runs_exactly_one_cycle_and_closes_ledger(self):
        daemon = unittest.mock.Mock()
        daemon.cycle.return_value = {"heartbeat": True, "events": {"sent": 0}, "commands": 0}
        with patch.object(run_p1_daemon, "_load_config", return_value={}), \
             patch.object(run_p1_daemon, "build_daemon", return_value=daemon):
            self.assertEqual(run_p1_daemon.main(["--config", "ignored.json", "--once"]), 0)
        daemon.cycle.assert_called_once_with()
        daemon.stop.assert_called_once_with()
        daemon.core.close.assert_called_once_with()

    def test_preflight_reports_missing_capture_configuration_without_secret_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in (
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
            ):
                (root / name).write_text("# fixture\n", encoding="utf-8")
            state = root / "bridge.sqlite"
            state.write_text("fixture", encoding="utf-8")
            result = run_p1_daemon.runtime_preflight({
                "crm_base_url": "https://crm.example",
                "bridge_id": "10000000-0000-4000-8000-000000000001",
                "account_id": "10000000-0000-4000-8000-000000000002",
                "account_epoch": 1,
                "business_context": "event_genix",
                "token": "x" * 32,
                "state_path": str(state),
            }, runtime_dir=root)
            self.assertTrue(result["ok"])
            self.assertTrue(result["statePathExists"])
            self.assertFalse(result["runtimeIdPresent"])
            self.assertEqual(result["liveInbound"]["status"], "disabled")
            self.assertEqual(result["liveInbound"]["blockReason"], "CAPTURE_NOT_CONFIGURED")
            self.assertEqual(result["sender"]["status"], "disabled")
            self.assertEqual(result["sender"]["blockReason"], "SENDER_NOT_CONFIGURED")
            self.assertIn("viberDesktop", result)
            self.assertNotIn("token", json.dumps(result))

    def test_runtime_id_is_stable_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = {
                "crm_base_url": "https://crm.example",
                "bridge_id": "10000000-0000-4000-8000-000000000001",
                "account_id": "10000000-0000-4000-8000-000000000002",
                "account_epoch": 1,
                "business_context": "event_genix",
                "token": "x" * 32,
                "state_path": str(root / "bridge.sqlite"),
            }
            first = run_p1_daemon._load_or_create_runtime_id(config)
            second = run_p1_daemon._load_or_create_runtime_id(config)
            self.assertEqual(first, second)
            self.assertEqual(str(UUID(first)), first)
            self.assertEqual((root / "runtime_id.txt").read_text(encoding="utf-8").strip(), first)

    def test_g3_sid_live_config_rejects_public_source_db_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "connector.json"
            config.write_text(json.dumps({
                "crm_base_url": "https://crm.example",
                "bridge_id": "10000000-0000-4000-8000-000000000001",
                "account_id": "10000000-0000-4000-8000-000000000002",
                "account_epoch": 1,
                "business_context": "event_genix",
                "token": "x" * 32,
                "state_path": str(root / "bridge.sqlite"),
                "live_inbound": {
                    "enabled": True,
                    "source_kind": "g3_sid",
                    "source_db_path": str(root / "viber.db"),
                    "journal_path": str(root / "capture.sqlite"),
                    "reference_key": "0" * 64,
                    "phone_marker": "EGXG3-0B038E78-PHONE",
                    "desktop_marker": "EGXG3-0B038E78-DESKTOP",
                },
            }), encoding="utf-8")
            with self.assertRaisesRegex(run_p1_daemon.LauncherError, "LIVE_INBOUND_CONFIG_INVALID"):
                run_p1_daemon._load_config(config)

    def test_g3_sid_preflight_reports_blocked_without_secret_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in (
                "g3_process.py", "g3_state.py", "observe_g3.py", "observe_g3_sid.py",
                "p1_bridge_core.py", "p1_daemon.py", "p1_dispatcher.py", "p1_http_client.py",
                "p1_live_inbound.py", "p1_paired_queries.py", "p1_transport.py",
                "probe_db_schema.py", "probe_key_presence.py", "qt_readonly_fixture.py",
                "recover_sid_key.py", "run_p1_daemon.py",
            ):
                (root / name).write_text("# fixture\n", encoding="utf-8")
            state = root / "bridge.sqlite"
            state.write_text("fixture", encoding="utf-8")
            result = run_p1_daemon.runtime_preflight({
                "crm_base_url": "https://crm.example",
                "bridge_id": "10000000-0000-4000-8000-000000000001",
                "account_id": "10000000-0000-4000-8000-000000000002",
                "account_epoch": 1,
                "business_context": "event_genix",
                "token": "x" * 32,
                "state_path": str(state),
                "live_inbound": {
                    "enabled": True,
                    "source_kind": "g3_sid",
                    "session_path": str(root / "missing-session"),
                    "journal_path": str(root / "capture.sqlite"),
                    "reference_key": "0" * 64,
                    "phone_marker": "EGXG3-0B038E78-PHONE",
                    "desktop_marker": "EGXG3-0B038E78-DESKTOP",
                },
            }, runtime_dir=root)
            self.assertEqual(result["liveInbound"]["sourceKind"], "g3_sid")
            self.assertEqual(result["liveInbound"]["sourceDbPathHidden"], True)
            self.assertEqual(result["liveInbound"]["status"], "blocked")
            self.assertNotIn("reference_key", json.dumps(result))
            self.assertNotIn("token", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
