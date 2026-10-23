"""Export only project sources; exclude dependencies, local settings and private files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "dist" / "points-table-miniprogram.zip"
FILES = [ROOT / name for name in (
    "README.md", "project.config.json", "package.json", "package-lock.json", ".gitignore"
)]
IGNORED = {"node_modules", "__pycache__", ".git", "dist"}
SUFFIXES = {".js", ".json", ".wxml", ".wxss", ".md", ".py"}

for directory in ("miniprogram", "cloudfunctions", "database", "docs", "scripts", "tests"):
    for source in (ROOT / directory).rglob("*"):
        relative = source.relative_to(ROOT)
        if not source.is_file() or any(part in IGNORED for part in relative.parts):
            continue
        if source.name in {"config.local.js", "project.private.config.json"}:
            continue
        if source.suffix in SUFFIXES:
            FILES.append(source)

TARGET.parent.mkdir(exist_ok=True)
with ZipFile(TARGET, "w", ZIP_DEFLATED) as archive:
    for source in sorted(FILES):
        archive.write(source, "points-table-miniprogram/" + source.relative_to(ROOT).as_posix())
    assert archive.testzip() is None
print(f"导出 {len(FILES)} 个文件：{TARGET} ({TARGET.stat().st_size:,} bytes)")
