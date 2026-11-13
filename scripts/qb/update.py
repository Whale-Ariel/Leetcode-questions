"""Fetch upstream snapshot repos and rebuild the question bank database.

更新流程：
1. 克隆或快进三份上游仓库到 raw/<name>/repo（doocs 使用稀疏检出，只取 LICENSE、
   根 README 和 solution 下的 README Markdown，不下载题解实现文件）。
2. 复用现有流水线（manifest → inventory → normalize → sample 验收 → 全量导入），
   重建到一个临时数据库；验收不通过时终止，不动现有数据库。
3. 备份现有数据库到 backups/，原子替换为新库，并做冒烟检查。

注意：更新前请停掉本地网页服务（serve 持有只读连接，Windows 上无法替换文件）。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from qb.cli import run_all
from qb.manifest import SOURCES
from qb.util import BACKUPS, DB_DIR, REPORTS, utc_now, write_json

FINAL_DB = DB_DIR / "question-bank.sqlite"
SPARSE_SOURCES = {"doocs"}


def _run(cmd: list, cwd: Path | None = None) -> None:
    print("+", " ".join(str(part) for part in cmd), flush=True)
    subprocess.run([str(part) for part in cmd], cwd=cwd, check=True)


def _git_commit(repo: Path) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def ensure_repo(name: str, meta: dict) -> str:
    """Clone or fast-forward one upstream repo; returns the new commit."""
    repo = meta["local"]
    url = meta["repo_url"]
    branch = meta["branch"]
    if (repo / ".git").is_dir():
        print(f"[update] {name}: fast-forward {branch}", flush=True)
        _run(["git", "-C", repo, "fetch", "origin", branch])
        _run(["git", "-C", repo, "checkout", branch])
        _run(["git", "-C", repo, "pull", "--ff-only", "origin", branch])
    else:
        print(f"[update] {name}: cloning {url}", flush=True)
        repo.parent.mkdir(parents=True, exist_ok=True)
        if name in SPARSE_SOURCES:
            _run(["git", "clone", "--filter=blob:none", "--sparse",
                  "--branch", branch, url, repo])
            _run(["git", "-C", repo, "sparse-checkout", "set", "--no-cone",
                  "/LICENSE", "/README.md", "solution/**/*.md"])
        else:
            _run(["git", "clone", "--branch", branch, url, repo])
    return _git_commit(repo) or ""


def fetch_all() -> dict:
    commits = {}
    for name, meta in SOURCES.items():
        commits[name] = ensure_repo(name, meta)
    return commits


def _remove_db(path: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(str(path) + suffix)
        if candidate.exists():
            candidate.unlink()


def swap_db(tmp_db: Path, final_db: Path, backup_dir: Path | None = None) -> Path | None:
    """Back up the current database, then atomically move the new one in."""
    stamp = utc_now().replace(":", "").replace("-", "")
    backup = None
    if final_db.exists():
        backup_dir = backup_dir or BACKUPS
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"question-bank-prev-{stamp}.sqlite"
        shutil.copy2(final_db, backup)
    # 旧的 WAL/SHM 侧车文件必须清掉，否则新库可能读到旧数据
    for suffix in ("-wal", "-shm"):
        stale = Path(str(final_db) + suffix)
        if stale.exists():
            stale.unlink()
    os.replace(tmp_db, final_db)
    return backup


def main(argv: list | None = None) -> None:
    parser = argparse.ArgumentParser(description="Update upstream snapshots and rebuild the DB")
    parser.add_argument("--db", default=str(FINAL_DB), help="final database path")
    parser.add_argument("--fetch-only", action="store_true",
                        help="只拉取上游仓库，不重建数据库")
    parser.add_argument("--skip-fetch", action="store_true",
                        help="跳过拉取，直接用现有 raw/ 重建")
    args = parser.parse_args(argv)

    if not args.skip_fetch:
        commits = fetch_all()
        print(json.dumps({"fetched": commits}, ensure_ascii=False, indent=2), flush=True)
    if args.fetch_only:
        return

    final_db = Path(args.db)
    tmp_db = Path(str(final_db) + ".update-tmp")
    _remove_db(tmp_db)

    print("[update] running pipeline into", tmp_db, flush=True)
    try:
        run_all(target_db=tmp_db)
    except SystemExit as exc:
        print(f"[update] pipeline refused to publish ({exc}); "
              f"临时库保留在 {tmp_db} 供排查", flush=True)
        raise

    backup = swap_db(tmp_db, final_db)
    summary = {
        "finished_at": utc_now(),
        "published": str(final_db),
        "previous_backup": str(backup) if backup else None,
    }
    write_json(REPORTS / "update-summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
