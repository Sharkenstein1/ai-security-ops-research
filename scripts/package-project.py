"""Export only project sources; exclude dependencies, local settings and private files."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "dist" / "points-table-miniprogram.zip"
FILES = [ROOT / name for name in (
    "README.md", "project.config.json", "package.json", "package-lock.json", ".gitignore", "Dockerfile", ".dockerignore"
)]
IGNORED = {"node_modules", "__pycache__", ".git", "dist"}
SUFFIXES = {".js", ".json", ".wxml", ".wxss", ".md", ".py", ".sql"}

for directory in ("miniprogram", "server", "docs", "scripts", "tests"):
    for source in (ROOT / directory).rglob("*"):
        relative = source.relative_to(ROOT)
        if not source.is_file() or any(part in IGNORED for part in relative.parts):
            continue
        if source.name in {"config.local.js", "project.private.config.json"}:
            continue
        if source.suffix in SUFFIXES:
            FILES.append(source)

def write_archive(target, sources, prefix=""):
    target.parent.mkdir(exist_ok=True)
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        for source in sorted(sources):
            info = ZipInfo(prefix + source.relative_to(ROOT).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes())
        assert archive.testzip() is None
    print(f"导出 {len(sources)} 个文件：{target} ({target.stat().st_size:,} bytes)")


deployment = ROOT / "releases" / "points-cloudrun-server.zip"
backend_files = [p for p in FILES if p.parts[len(ROOT.parts)] == "server" or p.name in {
    "Dockerfile", ".dockerignore", "package.json", "package-lock.json"
}]
write_archive(deployment, backend_files)
checksum = ROOT / "releases" / "SHA256SUMS"
checksum.write_text(hashlib.sha256(deployment.read_bytes()).hexdigest() + "  points-cloudrun-server.zip\n")
write_archive(TARGET, FILES + [deployment, checksum], "points-table-miniprogram/")
