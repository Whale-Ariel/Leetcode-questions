"""Export the question bank catalog (metadata only) for the static site in dist/.

Only directory metadata is exported: display_id, title, slug, difficulty,
category, tags, paid flag, site/locale and official URL. No statements,
examples, hints, starter code or any other LeetCode-authored content.
"""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "db" / "question-bank.sqlite"
OUT_PATH = REPO_ROOT / "dist" / "data" / "catalog.json"


def main() -> None:
    with closing(sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        rows = cur.execute(
            "SELECT p.id, i.site, i.slug, i.display_id, p.difficulty, p.category, "
            "p.is_paid_only, c.locale, c.title, i.url "
            "FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "ORDER BY CAST(i.display_id AS INTEGER), i.site, c.locale"
        ).fetchall()

        tags_map: dict[int, list[str]] = {}
        for r in cur.execute(
                "SELECT pt.problem_id, t.code FROM problem_tag pt "
                "JOIN tag t ON t.id = pt.tag_id ORDER BY t.code"):
            tags_map.setdefault(r["problem_id"], []).append(r["code"])

        problems = []
        for row in rows:
            problems.append({
                "id": row["id"],
                "site": row["site"],
                "slug": row["slug"],
                "display_id": row["display_id"],
                "title": row["title"],
                "difficulty": row["difficulty"],
                "category": row["category"],
                "is_paid_only": row["is_paid_only"],
                "locale": row["locale"],
                "url": row["url"],
                "tags": tags_map.get(row["id"], []),
            })

        issue_rows = cur.execute(
            "SELECT d.id, d.issue_type, d.severity, d.status, d.detail_json, d.problem_id "
            "FROM data_issue d ORDER BY d.id").fetchall()
        problem_map: dict[int, dict] = {}
        ids = [r["problem_id"] for r in issue_rows if r["problem_id"] is not None]
        for r in cur.execute(
                "SELECT i.problem_id, i.site, i.slug, i.display_id, c.title, c.locale "
                "FROM problem_source_identity i "
                "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
                f"WHERE i.problem_id IN ({', '.join('?' * len(ids))})", ids):
            if r["problem_id"] not in problem_map or (
                    r["site"] == "leetcode.com" and r["locale"] == "en"
                    and not (problem_map[r["problem_id"]]["site"] == "leetcode.com"
                             and problem_map[r["problem_id"]]["locale"] == "en")):
                problem_map[r["problem_id"]] = {
                    "site": r["site"], "slug": r["slug"], "display_id": r["display_id"],
                    "title": r["title"], "locale": r["locale"],
                }

        issues = []
        for row in issue_rows:
            detail = json.loads(row["detail_json"]) if row["detail_json"] else {}
            issues.append({
                "id": row["id"],
                "issue_type": row["issue_type"],
                "severity": row["severity"],
                "status": row["status"],
                "message": detail.get("message"),
                "detail": detail.get("detail"),
                "problem": problem_map.get(row["problem_id"]),
            })

        generated_at = cur.execute(
            "SELECT MAX(finished_at) FROM import_batch").fetchone()[0]

    catalog = {
        "generated_at": generated_at,
        "problems": problems,
        "issues": issues,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
    size = OUT_PATH.stat().st_size
    print(f"wrote {OUT_PATH}")
    print(f"problems: {len(problems)}, issues: {len(issues)}, "
          f"file size: {size / 1024 / 1024:.2f} MiB")


if __name__ == "__main__":
    main()
