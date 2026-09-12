"""Download/verify/extract one official pinned wheel without executing it.

Temporary research tooling only: no pip/setup hooks, package imports, Viber
account access, or project dependency changes. Inspect extracted code first.
"""

import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import tempfile
import urllib.request
import zipfile


NAME = "capstone-5.0.9-py3-none-win_amd64.whl"
URL = "https://files.pythonhosted.org/packages/50/e6/6f06fdb6a9ed32b2f7cd9c036b92d5324112c3ef7080f2c71efc367d40dd/capstone-5.0.9-py3-none-win_amd64.whl"
SHA256 = "732cedbbb56d42e723f14d7af6387f1454194a820b4b96b56d1e53f865ef85d0"
SIZE = 1273459


def main():
    temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
    root = Path(tempfile.mkdtemp(prefix="eventgenix-capstone-static-", dir=temp_root)).resolve(strict=True)
    if root.parent != temp_root or any(item.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
                                       for item in (root, *root.parents)):
        raise ValueError("TEMP_PATH_REJECTED")
    archive = root / NAME
    bindings = root / "bindings"
    bindings.mkdir()
    size = 0
    digest = hashlib.sha256()
    with urllib.request.urlopen(URL, timeout=20) as response, archive.open("xb") as output:
        if response.url != URL:
            raise ValueError("UNEXPECTED_DOWNLOAD_URL")
        while block := response.read(256 * 1024):
            size += len(block)
            if size > SIZE:
                raise ValueError("DOWNLOAD_SIZE_LIMIT")
            digest.update(block)
            output.write(block)
    if size != SIZE or digest.hexdigest() != SHA256:
        raise ValueError("WHEEL_INTEGRITY_FAILED")
    with zipfile.ZipFile(archive) as wheel:
        members = wheel.infolist()
        if len(members) > 512 or sum(member.file_size for member in members) > 32 * 1024 * 1024:
            raise ValueError("ARCHIVE_LIMIT")
        targets = set()
        for member in members:
            path = PurePosixPath(member.filename)
            target = (bindings / member.filename).resolve()
            marker = str(target).casefold()
            if (path.is_absolute() or ".." in path.parts or ":" in member.filename
                    or "\\" in member.filename or not target.is_relative_to(bindings)
                    or stat.S_IFMT(member.external_attr >> 16) == stat.S_IFLNK
                    or marker in targets or any(part.endswith((" ", ".")) for part in path.parts)):
                raise ValueError("ARCHIVE_PATH_REJECTED")
            targets.add(marker)
        wheel.extractall(bindings)
    selected = {}
    for relative in ("capstone/__init__.py", "capstone/x86.py", "capstone/lib/capstone.dll"):
        path = bindings / relative
        if not path.is_file():
            raise ValueError("EXPECTED_MEMBER_MISSING")
        selected[relative] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": path.stat().st_size}
    print(json.dumps({"status": "PREPARED_NOT_EXECUTED", "wheel_sha256": SHA256,
                      "wheel_size_verified": True, "bindings_path": str(bindings),
                      "selected_members": selected, "package_code_executed": False,
                      "project_dependencies_changed": False}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"status":"PREPARATION_FAILED","package_code_executed":false}')
        raise SystemExit(2) from None
