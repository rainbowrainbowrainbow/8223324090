from pathlib import Path
import json
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
