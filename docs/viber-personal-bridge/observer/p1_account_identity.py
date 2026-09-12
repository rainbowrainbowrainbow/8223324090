"""Local account identity proof for one Viber Desktop profile.

The expected E.164 number is compared only in memory with the guarded account
directory name. Public output contains opaque HMAC references, never the number
or account path.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path
import re
import stat
from typing import Any


_E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")


class AccountIdentityError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _opaque(secret: bytes, namespace: bytes, value: bytes) -> str:
    if not isinstance(secret, bytes) or len(secret) < 32:
        raise AccountIdentityError("REFERENCE_KEY_INVALID")
    return hmac.new(secret, namespace + b"\0" + value, hashlib.sha256).hexdigest()


def _regular_no_reparse(path: Path) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError:
        raise AccountIdentityError("ACCOUNT_SOURCE_UNAVAILABLE") from None
    attributes = getattr(info, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if not stat.S_ISREG(info.st_mode) or attributes & reparse or info.st_nlink != 1:
        raise AccountIdentityError("ACCOUNT_SOURCE_REJECTED")
    return info


def _directory_no_reparse(path: Path) -> None:
    try:
        info = path.lstat()
    except OSError:
        raise AccountIdentityError("ACCOUNT_SOURCE_UNAVAILABLE") from None
    attributes = getattr(info, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if not stat.S_ISDIR(info.st_mode) or attributes & reparse:
        raise AccountIdentityError("ACCOUNT_SOURCE_REJECTED")


def verify_layout(viber_root: str | Path, expected_e164: str, reference_key: bytes) -> dict[str, Any]:
    """Verify one exact account directory; testable without opening Viber DB."""
    if not isinstance(expected_e164, str) or _E164.fullmatch(expected_e164) is None:
        raise AccountIdentityError("EXPECTED_ACCOUNT_INVALID")
    root = Path(viber_root).absolute()
    _directory_no_reparse(root)
    try:
        resolved_root = root.resolve(strict=True)
    except OSError:
        raise AccountIdentityError("ACCOUNT_SOURCE_UNAVAILABLE") from None
    if resolved_root != root:
        raise AccountIdentityError("ACCOUNT_SOURCE_REJECTED")

    candidates = []
    try:
        children = list(root.iterdir())
    except OSError:
        raise AccountIdentityError("ACCOUNT_SOURCE_UNAVAILABLE") from None
    for child in children:
        if re.fullmatch(r"[1-9][0-9]{7,14}", child.name) is None:
            continue
        database = child / "viber.db"
        if database.exists():
            _directory_no_reparse(child)
            _regular_no_reparse(database)
            if database.resolve(strict=True) != database.absolute():
                raise AccountIdentityError("ACCOUNT_SOURCE_REJECTED")
            candidates.append(database)
    if len(candidates) != 1:
        raise AccountIdentityError("ACCOUNT_SOURCE_NOT_UNIQUE")

    database = candidates[0]
    actual_digits = database.parent.name.encode("ascii")
    expected_digits = expected_e164[1:].encode("ascii")
    if not hmac.compare_digest(actual_digits, expected_digits):
        raise AccountIdentityError("ACCOUNT_IDENTITY_MISMATCH")
    info = _regular_no_reparse(database)
    file_identity = f"{info.st_dev}:{info.st_ino}".encode("ascii")
    return {
        "account_verified": True,
        "proof_method": "expected_e164_matches_guarded_db_directory",
        "account_ref": _opaque(reference_key, b"viber-account", expected_e164.encode("ascii")),
        "source_generation_ref": _opaque(reference_key, b"viber-db-file", file_identity),
        "account_value_exported": False,
        "database_opened": False,
        "messages_queried": False,
    }


def verify_current_account(expected_e164: str, reference_key: bytes) -> dict[str, Any]:
    """Use the fixed current-user Windows ViberPC root."""
    appdata = os.environ.get("APPDATA")
    if os.name != "nt" or not appdata:
        raise AccountIdentityError("PLATFORM_UNSUPPORTED")
    return verify_layout(Path(appdata) / "ViberPC", expected_e164, reference_key)
