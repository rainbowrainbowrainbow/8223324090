"""Retain continuity of one verified Viber process using a query-only handle.

No memory reads, process writes, termination, injection or periodic discovery.
The caller supplies the already reviewed probe helpers. A live process does
not prove account identity, network connectivity or inbound message delivery.
"""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path


PROCESS_QUERY_INFORMATION = 0x0400
STILL_ACTIVE = 259
ERROR_CODES = {"SOURCE_TARGET_CHANGED", "TARGET_NOT_VERIFIED"}


class ProcessGuardError(Exception):
    def __init__(self, code):
        self.code = code if type(code) is str and code in ERROR_CODES else "TARGET_NOT_VERIFIED"
        super().__init__(self.code)


class ProcessGuard:
    def __init__(self, kernel, handle):
        self._kernel = kernel
        self._handle = handle

    def alive(self):
        """Check only the retained handle; never reopen a potentially reused PID."""
        if self._handle is None:
            return False
        try:
            code = wintypes.DWORD()
            return bool(self._kernel.GetExitCodeProcess(self._handle, ctypes.byref(code))
                        and code.value == STILL_ACTIVE)
        except Exception:
            return False

    def close(self):
        """Close once; repeated cleanup does not close a reused Windows handle."""
        handle, self._handle = self._handle, None
        if handle is None:
            return
        try:
            if not self._kernel.CloseHandle(handle):
                raise ProcessGuardError("SOURCE_TARGET_CHANGED")
        except Exception:
            raise ProcessGuardError("SOURCE_TARGET_CHANGED") from None


def capture(probe):
    """Bind one signed, same-owner process and verify the opened handle identity."""
    handle = None
    kernel = None
    try:
        target = probe.signed_target()
        if (type(target) is not dict or target.keys() != {"id", "created"}
                or type(target["id"]) is not int or not 0 < target["id"] <= 0xFFFFFFFF
                or type(target["created"]) is not int or not 0 < target["created"] <= 0xFFFFFFFFFFFFFFFF):
            raise ProcessGuardError("TARGET_NOT_VERIFIED")
        kernel, advapi = probe.windows_api()
        handle = kernel.OpenProcess(PROCESS_QUERY_INFORMATION, False, target["id"])
        if not handle:
            handle = None
            raise ProcessGuardError("TARGET_NOT_VERIFIED")
        image = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(image))
        if not kernel.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(length)):
            raise ProcessGuardError("TARGET_NOT_VERIFIED")
        expected = str(Path(os.environ["LOCALAPPDATA"]) / "Viber" / "Viber.exe")
        if not 0 < length.value < len(image) or os.path.normcase(image.value) != os.path.normcase(expected):
            raise ProcessGuardError("TARGET_NOT_VERIFIED")
        times = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)):
            raise ProcessGuardError("TARGET_NOT_VERIFIED")
        created = times[0].dwLowDateTime | (times[0].dwHighDateTime << 32)
        if created != target["created"] or not probe.same_owner(kernel, advapi, handle):
            raise ProcessGuardError("TARGET_NOT_VERIFIED")
        guard = ProcessGuard(kernel, handle)
        if not guard.alive():
            raise ProcessGuardError("SOURCE_TARGET_CHANGED")
        handle = None  # Ownership transfers only after every capture check.
        return guard
    except ProcessGuardError:
        raise
    except Exception:
        raise ProcessGuardError("TARGET_NOT_VERIFIED") from None
    finally:
        if handle is not None and kernel is not None:
            try:
                kernel.CloseHandle(handle)
            except BaseException:
                # No diagnostics from Windows or supplied helpers are exposed.
                pass
