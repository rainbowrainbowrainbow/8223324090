"""Extract two pinned official Qt wheels to a new temporary experiment folder.

Does not install packages, run wheel scripts or import Qt. No Viber/account access.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import tempfile
import urllib.request
import zipfile


PACKAGES = [
    {
        "name": "PySide6_Essentials-6.8.3-cp39-abi3-win_amd64.whl",
        "url": "https://files.pythonhosted.org/packages/8e/0f/5d8c6da7586e57ee032643e0c0e62335ef1a1add1a980160ddd1654f1d8d/PySide6_Essentials-6.8.3-cp39-abi3-win_amd64.whl",
        "sha256": "3c0fae5550aff69f2166f46476c36e0ef56ce73d84829eac4559770b0c034b07",
        "size": 72191029,
    },
    {
        "name": "shiboken6-6.8.3-cp39-abi3-win_amd64.whl",
        "url": "https://files.pythonhosted.org/packages/aa/29/e77f3fba5337f2d98f977eece0fd24cda6cf7d83be2699514d2ca1d34f6c/shiboken6-6.8.3-cp39-abi3-win_amd64.whl",
        "sha256": "bca3a94513ce9242f7d4bbdca902072a1631888e0aa3a8711a52cc5dbe93588f",
        "size": 1150998,
    },
]


def main():
    root = Path(tempfile.mkdtemp(prefix="eventgenix-viber-qt-g2-")).resolve()
    target_root = root / "bindings"
    target_root.mkdir()
    for package in PACKAGES:
        archive = root / package["name"]
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(package["url"], timeout=25) as response, archive.open("xb") as output:
            if not response.url.startswith("https://files.pythonhosted.org/"):
                raise ValueError("unexpected_host")
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > package["size"]:
                    raise ValueError("size_exceeded")
                digest.update(block)
                output.write(block)
        if size != package["size"] or digest.hexdigest() != package["sha256"]:
            raise ValueError("hash_or_size_mismatch")
        with zipfile.ZipFile(archive) as wheel:
            members = wheel.infolist()
            if len(members) > 6000 or sum(m.file_size for m in members) > 512 * 1024 * 1024:
                raise ValueError("archive_limit_exceeded")
            for member in members:
                path = PurePosixPath(member.filename)
                resolved = (target_root / member.filename).resolve()
                is_symlink = ((member.external_attr >> 16) & 0o170000) == 0o120000
                if (path.is_absolute() or ".." in path.parts or ":" in member.filename
                        or "\\" in member.filename or is_symlink
                        or not resolved.is_relative_to(target_root)):
                    raise ValueError("unsafe_archive_member")
                if resolved.exists() and not resolved.is_dir():
                    raise ValueError("archive_file_collision")
            wheel.extractall(target_root)
        print(json.dumps({"package": package["name"], "hash_verified": True, "size_verified": True}), flush=True)
    print(json.dumps({"status": "prepared", "bindings_path": str(target_root),
                      "package_code_executed": False, "crm_dependencies_changed": False}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"status": "runtime_preparation_failed"}))
        raise SystemExit(2)
