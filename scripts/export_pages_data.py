"""Export the question bank into static JSON for GitHub Pages."""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "db" / "question-bank.sqlite"
OUT_DIR = ROOT / "client" / "public" / "data"
SAFE_KEY = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")


def load_json_list(value: str | None) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def file_key(slug: str | None, problem_id: int) -> str:
    if slug and all(ch in SAFE_KEY for ch in slug):
        return slug
    return f"id-{problem_id}"


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"missing database: {DB_PATH}")

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row

    tags_by_problem: dict[int, list[dict[str, str]]] = defaultdict(list)
    for row in connection.execute(
        """
        SELECT pt.problem_id, t.code, t.name, t.source
        FROM problem_tag pt
        JOIN tag t ON t.id = pt.tag_id
        ORDER BY t.code
        """
    ):
        tags_by_problem[row["problem_id"]].append(
            {"code": row["code"], "name": row["name"], "source": row["source"]}
        )

    examples_by_content: dict[int, list[dict]] = defaultdict(list)
    for row in connection.execute(
        """
        SELECT content_id, ordinal, input_text, output_text, explanation
        FROM problem_example
        ORDER BY ordinal
        """
    ):
        examples_by_content[row["content_id"]].append(
            {
                "ordinal": row["ordinal"],
                "input": row["input_text"],
                "output": row["output_text"],
                "explanation": row["explanation"],
            }
        )

    hints_by_content: dict[tuple[int, str], list[str]] = defaultdict(list)
    for row in connection.execute(
        """
        SELECT content_id, locale, body
        FROM problem_hint
        ORDER BY ordinal
        """
    ):
        hints_by_content[(row["content_id"], row["locale"])].append(row["body"])

    codes_by_problem: dict[int, list[dict]] = defaultdict(list)
    seen_languages: dict[int, set[str]] = defaultdict(set)
    for row in connection.execute(
        """
        SELECT problem_id, language, language_name, template
        FROM starter_code
        WHERE is_current = 1
        ORDER BY language, id
        """
    ):
        languages = seen_languages[row["problem_id"]]
        if row["language"] in languages:
            continue
        languages.add(row["language"])
        codes_by_problem[row["problem_id"]].append(
            {
                "language": row["language"],
                "languageName": row["language_name"],
                "template": row["template"],
            }
        )

    entries = []
    written = 0
    used_keys: set[tuple[str, str, str]] = set()
    problems_dir = OUT_DIR / "problems"
    if problems_dir.exists():
        for old in problems_dir.rglob("*.json"):
            old.unlink()

    rows = connection.execute(
        """
        SELECT
          p.id, p.difficulty, p.category, p.is_paid_only,
          i.site, i.display_id, i.slug, i.url,
          c.id AS content_id, c.locale, c.title, c.statement_markdown,
          c.constraints_json, c.follow_ups_json
        FROM problem p
        JOIN problem_source_identity i ON i.problem_id = p.id
        JOIN problem_content c ON c.source_identity_id = i.id
        WHERE c.is_current = 1
        ORDER BY i.site, c.locale, i.display_id
        """
    )

    for row in rows:
        key = file_key(row["slug"], row["id"])
        identity = (row["site"], row["locale"], key)
        if identity in used_keys:
            key = f"id-{row['id']}"
            identity = (row["site"], row["locale"], key)
        used_keys.add(identity)

        tag_details = tags_by_problem.get(row["id"], [])
        detail = {
            "id": row["id"],
            "displayId": row["display_id"],
            "slug": row["slug"],
            "title": row["title"],
            "difficulty": row["difficulty"],
            "category": row["category"],
            "isPaidOnly": row["is_paid_only"] == 1,
            "site": row["site"],
            "url": row["url"],
            "tags": tag_details,
            "content": {
                "statement": row["statement_markdown"],
                "constraints": load_json_list(row["constraints_json"]),
                "followUps": load_json_list(row["follow_ups_json"]),
                "examples": examples_by_content.get(row["content_id"], []),
            },
            "hints": hints_by_content.get((row["content_id"], row["locale"]), []),
            "hintsLocked": False,
            "starterCodes": codes_by_problem.get(row["id"], []),
        }
        destination = problems_dir / row["site"] / row["locale"] / f"{key}.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        written += 1

        entries.append(
            {
                "id": row["id"],
                "displayId": row["display_id"],
                "slug": row["slug"],
                "title": row["title"],
                "difficulty": row["difficulty"],
                "category": row["category"],
                "site": row["site"],
                "locale": row["locale"],
                "tags": [tag["code"] for tag in tag_details],
                "key": key,
            }
        )

    tag_counts: dict[tuple[str, str, str], int] = defaultdict(int)
    tag_names: dict[tuple[str, str], tuple[str, str]] = {}
    for tag_list in tags_by_problem.values():
        for tag in tag_list:
            tag_counts[(tag["source"], tag["code"], tag["name"])] += 1
            tag_names[(tag["source"], tag["code"])] = (tag["name"], tag["source"])

    tags = [
        {"code": code, "name": name, "source": source, "count": count}
        for (source, code, name), count in tag_counts.items()
    ]
    tags.sort(key=lambda item: (-item["count"], item["code"]))

    category_counts: dict[str, int] = defaultdict(int)
    seen_problem_categories: set[int] = set()
    for entry in entries:
        if entry["id"] in seen_problem_categories or not entry["category"]:
            continue
        seen_problem_categories.add(entry["id"])
        category_counts[entry["category"]] += 1
    categories = [
        {"name": name, "count": count}
        for name, count in sorted(category_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    catalog_path = OUT_DIR / "catalog.json"
    catalog_path.write_text(
        json.dumps({"entries": entries, "tags": tags, "categories": categories}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {written} problems and {catalog_path}")


if __name__ == "__main__":
    main()
