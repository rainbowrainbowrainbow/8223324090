"""Synthetic process guard tests. Never import or invoke the real Viber probe."""
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("g3_process", Path(__file__).with_name("g3_process.py"))
guard_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard_module)


class FakeKernel:
    def __init__(self):
        self.handle = 101
        self.created = 0x123456789ABC
        self.image = str(Path(r"C:\Synthetic\Local") / "Viber" / "Viber.exe")
        self.exit_code = guard_module.STILL_ACTIVE
        self.query_ok = self.times_ok = self.exit_ok = self.close_ok = True
        self.open_calls = []
        self.close_calls = []
        self.exit_handles = []

    def OpenProcess(self, rights, inherit, pid):
        self.open_calls.append((rights, inherit, pid))
        return self.handle

    def QueryFullProcessImageNameW(self, handle, flags, image, length):
        image.value = self.image
        length._obj.value = len(self.image)
        return self.query_ok

    def GetProcessTimes(self, handle, created, exited, kernel, user):
        created._obj.dwLowDateTime = self.created & 0xFFFFFFFF
        created._obj.dwHighDateTime = self.created >> 32
        return self.times_ok

    def GetExitCodeProcess(self, handle, code):
        self.exit_handles.append(handle)
        code._obj.value = self.exit_code
        return self.exit_ok

    def CloseHandle(self, handle):
        self.close_calls.append(handle)
        return self.close_ok

    def ReadProcessMemory(self, *_args):
        raise AssertionError("memory reading is forbidden in process guard")


class FakeProbe:
    def __init__(self):
        self.kernel = FakeKernel()
        self.target = {"id": 321, "created": self.kernel.created}
        self.owner_ok = True
        self.signed_calls = 0
        self.api_calls = 0

    def signed_target(self):
        self.signed_calls += 1
        return self.target

    def windows_api(self):
        self.api_calls += 1
        return self.kernel, object()

    def same_owner(self, *_args):
        return self.owner_ok


class ProcessGuardTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"LOCALAPPDATA": r"C:\Synthetic\Local"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.probe = FakeProbe()

    def test_query_only_rights_and_same_handle_polls(self):
        guard = guard_module.capture(self.probe)
        self.assertEqual(self.probe.kernel.open_calls, [(0x0400, False, 321)])
        self.assertTrue(guard.alive())
        self.assertTrue(guard.alive())
        self.assertEqual(self.probe.signed_calls, 1)
        self.assertEqual(self.probe.api_calls, 1)
        self.assertEqual(self.probe.kernel.exit_handles, [101, 101, 101])
        guard.close()
        guard.close()
        self.assertEqual(self.probe.kernel.close_calls, [101])
        self.assertFalse(guard.alive())

    def test_exited_process_is_not_reopened(self):
        guard = guard_module.capture(self.probe)
        self.probe.kernel.exit_code = 0
        self.probe.target = {"id": 321, "created": self.probe.kernel.created + 1}
        self.assertFalse(guard.alive())
        self.assertEqual(len(self.probe.kernel.open_calls), 1)
        self.assertEqual(self.probe.signed_calls, 1)
        guard.close()

    def test_exit_query_failure_is_not_alive(self):
        guard = guard_module.capture(self.probe)
        self.probe.kernel.exit_ok = False
        self.assertFalse(guard.alive())
        guard.close()

    def test_bad_discovery_never_opens_process(self):
        for target in (None, {"failure": "signature"}, {"id": True, "created": 1},
                       {"id": 0, "created": 1}, {"id": 1, "created": -1},
                       {"id": 1 << 32, "created": 1}, {"id": 1, "created": 1 << 64},
                       {"id": 1, "created": 1, "extra": "synthetic"}):
            with self.subTest(target_shape=type(target).__name__):
                probe = FakeProbe()
                probe.target = target
                with self.assertRaises(guard_module.ProcessGuardError) as caught:
                    guard_module.capture(probe)
                self.assertEqual(caught.exception.code, "TARGET_NOT_VERIFIED")
                self.assertEqual(probe.kernel.open_calls, [])
                self.assertEqual(probe.kernel.close_calls, [])

    def test_failed_open_does_not_close_null(self):
        self.probe.kernel.handle = 0
        with self.assertRaises(guard_module.ProcessGuardError):
            guard_module.capture(self.probe)
        self.assertEqual(self.probe.kernel.close_calls, [])

    def test_capture_failures_close_owned_handle(self):
        changes = [("query_ok", False), ("times_ok", False),
                   ("image", "synthetic-wrong-image"), ("created", 99),
                   ("exit_ok", False), ("exit_code", 0)]
        for field, value in changes:
            with self.subTest(stage=field):
                probe = FakeProbe()
                setattr(probe.kernel, field, value)
                with self.assertRaises(guard_module.ProcessGuardError):
                    guard_module.capture(probe)
                self.assertEqual(probe.kernel.close_calls, [101])

    def test_owner_mismatch_closes_handle(self):
        self.probe.owner_ok = False
        with self.assertRaises(guard_module.ProcessGuardError):
            guard_module.capture(self.probe)
        self.assertEqual(self.probe.kernel.close_calls, [101])

    def test_private_exception_redacted_and_handle_closed(self):
        def failure(*_args):
            raise RuntimeError("synthetic private path and other material")

        self.probe.same_owner = failure
        with self.assertRaises(guard_module.ProcessGuardError) as caught:
            guard_module.capture(self.probe)
        self.assertEqual(str(caught.exception), "TARGET_NOT_VERIFIED")
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertEqual(self.probe.kernel.close_calls, [101])

    def test_interrupt_during_capture_closes_handle(self):
        def interrupted(*_args):
            raise KeyboardInterrupt()

        self.probe.same_owner = interrupted
        with self.assertRaises(KeyboardInterrupt):
            guard_module.capture(self.probe)
        self.assertEqual(self.probe.kernel.close_calls, [101])

    def test_close_failure_is_fixed_and_never_double_closes(self):
        guard = guard_module.capture(self.probe)
        self.probe.kernel.close_ok = False
        with self.assertRaises(guard_module.ProcessGuardError) as caught:
            guard.close()
        self.assertEqual(caught.exception.code, "SOURCE_TARGET_CHANGED")
        guard.close()
        self.assertFalse(guard.alive())
        self.assertEqual(self.probe.kernel.close_calls, [101])


if __name__ == "__main__":
    unittest.main()
