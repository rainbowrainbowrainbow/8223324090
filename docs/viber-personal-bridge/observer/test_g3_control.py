"""Control-pipe checks for our own synthetic child only; no Viber access."""
import io
from pathlib import Path
import subprocess
import sys
import threading
import unittest

from observe_g3 import watch_stop_input


class WorkerControlTests(unittest.TestCase):
    def test_stop_eof_and_unknown_input_all_stop_without_interpretation(self):
        for control in ("stop\n", "", "arbitrary synthetic command\n", "x" * 128):
            with self.subTest(control_length=len(control)):
                event = threading.Event()
                watch_stop_input(io.StringIO(control), event)
                self.assertTrue(event.is_set())

    def test_control_read_failure_sets_stop(self):
        class BrokenInput:
            def readline(self, _limit):
                raise OSError("synthetic pipe failure")
        event = threading.Event()
        with self.assertRaises(OSError):
            watch_stop_input(BrokenInput(), event)
        self.assertTrue(event.is_set())

    def test_closed_parent_pipe_exits_only_own_stalled_worker(self):
        # The child simulates work that never checks the stop event. It never
        # invokes worker(), Qt, process inspection, or any account loader.
        source = """
import importlib.util, sys, time
from pathlib import Path
path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('synthetic_control', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.start_worker_control(600, sys.stdin)
time.sleep(30)
raise SystemExit(99)
"""
        process = subprocess.Popen(
            [sys.executable, "-I", "-B", "-c", source,
             str(Path(__file__).with_name("observe_g3.py").resolve())],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        try:
            process.stdin.close()
            self.assertEqual(process.wait(timeout=10), 73)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
