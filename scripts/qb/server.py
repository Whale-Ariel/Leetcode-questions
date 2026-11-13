"""Read-only local web server for the question bank."""

from __future__ import annotations

import gzip
import json
import mimetypes
import re
import sqlite3
import threading
import webbrowser
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from qb.auth import (
    AUTH_DB,
    SESSION_COOKIE,
    SESSION_TTL,
    AuthError,
    ROLE_LABELS,
    authenticate,
    connect_auth,
    create_session,
    create_user,
    drop_session,
    resolve_session,
    seed_if_missing,
)

ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = ROOT / "web" / "static"
DB_DEFAULT = ROOT / "db" / "question-bank.sqlite"

SITES = {"leetcode.com", "leetcode.cn"}
LOCALES = {"en", "zh-CN"}
CATEGORIES = {"algorithm", "database", "shell", "concurrency", "javascript", "pandas", "unknown"}
DIFFICULTIES = {"easy", "medium", "hard"}
PAID_VALUES = {"0", "1", "unknown"}
SORTS = {"display_id", "difficulty", "title"}
SLUG_RE = re.compile(r"^[a-z0-9-]+$")

SECURITY_HEADERS = [
    ("Content-Security-Policy",
     "default-src 'self'; img-src 'self' https: data:; style-src 'self'; "
     # wasm-unsafe-eval: Pyodide；unsafe-eval: 本地运行用户 JS（仅本机工具，
     # 页面脚本仍全部来自 'self'，无内联脚本）
     "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self'; frame-ancestors 'none'"),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
]


def connect_ro(path: Path) -> sqlite3.Connection:
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def api_health(db: Path) -> dict:
    with closing(connect_ro(db)) as conn:
        problems = conn.execute("SELECT COUNT(*) FROM problem").fetchone()[0]
    return {"ok": True, "problems": problems, "db": db.name}


def api_meta(db: Path) -> dict:
    with closing(connect_ro(db)) as conn:
        sites = {r["site"]: r["n"] for r in conn.execute(
            "SELECT site, COUNT(*) AS n FROM problem_source_identity GROUP BY site")}
        difficulties = {r["difficulty"]: r["n"] for r in conn.execute(
            "SELECT difficulty, COUNT(*) AS n FROM problem "
            "WHERE difficulty IS NOT NULL GROUP BY difficulty")}
        categories = {r["category"]: r["n"] for r in conn.execute(
            "SELECT COALESCE(category, 'unknown') AS category, COUNT(*) AS n "
            "FROM problem GROUP BY 1")}
        paid = {r["bucket"]: r["n"] for r in conn.execute(
            "SELECT CASE WHEN is_paid_only = 1 THEN 'premium' "
            "WHEN is_paid_only = 0 THEN 'free' ELSE 'unknown' END AS bucket, "
            "COUNT(*) AS n FROM problem GROUP BY 1")}
        locales = {r["locale"]: r["n"] for r in conn.execute(
            "SELECT locale, COUNT(*) AS n FROM problem_content "
            "WHERE is_current = 1 GROUP BY locale")}
        generated_at = conn.execute(
            "SELECT MAX(finished_at) FROM import_batch").fetchone()[0]
    return {
        "sites": sites,
        "locales": locales,
        "difficulties": difficulties,
        "categories": categories,
        "paid": {key: paid.get(key, 0) for key in ("premium", "free", "unknown")},
        "enums": {
            "site": sorted(SITES),
            "locale": sorted(LOCALES),
            "category": sorted(CATEGORIES),
            "difficulty": sorted(DIFFICULTIES),
            "paid": sorted(PAID_VALUES),
            "sort": sorted(SORTS),
        },
        "generated_at": generated_at,
    }


def _split_list(values) -> list[str]:
    out = []
    for value in values:
        out.extend(item.strip() for item in value.split(",") if item.strip())
    return out


def like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


ORDER_BY = {
    "display_id": "CAST(i.display_id AS INTEGER), i.site, c.locale",
    "difficulty": ("CASE p.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 "
                   "WHEN 'hard' THEN 3 ELSE 4 END, CAST(i.display_id AS INTEGER), i.site"),
    "title": "c.title COLLATE NOCASE, CAST(i.display_id AS INTEGER), i.site",
}


def api_problems(db: Path, query: dict) -> dict:
    q = (query.get("q", [""])[0] or "").strip()[:100]
    search_in = query.get("search_in", ["meta"])[0]
    if search_in not in ("meta", "all"):
        raise ValueError("search_in must be meta or all")
    site = query.get("site", [""])[0] or None
    if site is not None and site not in SITES:
        raise ValueError("site must be leetcode.com or leetcode.cn")
    locale = query.get("locale", [""])[0] or None
    if locale is not None and locale not in LOCALES:
        raise ValueError("locale must be en or zh-CN")
    paid = query.get("paid", [""])[0] or None
    if paid is not None and paid not in PAID_VALUES:
        raise ValueError("paid must be 1, 0 or unknown")
    tag = query.get("tag", [""])[0] or None
    if tag is not None and (not tag.strip() or len(tag) > 100):
        raise ValueError("invalid tag")
    has_statement = query.get("has_statement", ["0"])[0] == "1"
    has_examples = query.get("has_examples", ["0"])[0] == "1"
    difficulties = _split_list(query.get("difficulty", []))
    invalid = set(difficulties) - DIFFICULTIES
    if invalid:
        raise ValueError("invalid difficulty: " + ", ".join(sorted(invalid)))
    categories = _split_list(query.get("category", []))
    invalid = set(categories) - CATEGORIES
    if invalid:
        raise ValueError("invalid category: " + ", ".join(sorted(invalid)))
    sort = query.get("sort", ["display_id"])[0]
    if sort not in SORTS:
        raise ValueError("sort must be display_id, difficulty or title")
    try:
        page = int(query.get("page", ["1"])[0])
        page_size = min(int(query.get("page_size", ["20"])[0]), 100)
    except ValueError:
        raise ValueError("page and page_size must be integers") from None
    if page < 1 or page_size < 1:
        raise ValueError("page and page_size must be >= 1")

    where = ["c.is_current = 1"]
    params: list = []

    def add(sql: str, *values) -> None:
        where.append(sql)
        params.extend(values)

    if q:
        numeric = re.fullmatch(r"#?\d+", q)
        if numeric:
            add("i.display_id = ?", q.lstrip("#"))
        else:
            esc = like_escape(q)
            q_clauses = [
                "i.slug = ?",
                "i.slug LIKE ? ESCAPE '\\'",
                "c.title LIKE ? ESCAPE '\\'",
            ]
            params.extend([q, f"{esc}%", f"%{esc}%"])
            if search_in == "all":
                q_clauses.append("c.statement_markdown LIKE ? ESCAPE '\\'")
                params.append(f"%{esc}%")
            add("(" + " OR ".join(q_clauses) + ")")
    if site:
        add("i.site = ?", site)
    if locale:
        add("c.locale = ?", locale)
    if paid == "1":
        add("p.is_paid_only = 1")
    elif paid == "0":
        add("p.is_paid_only = 0")
    elif paid == "unknown":
        add("p.is_paid_only IS NULL")
    if tag:
        add("EXISTS (SELECT 1 FROM problem_tag pt JOIN tag t ON t.id = pt.tag_id "
            "WHERE pt.problem_id = p.id AND t.code = ?)", tag)
    if difficulties:
        placeholders = ", ".join("?" * len(difficulties))
        add(f"p.difficulty IN ({placeholders})", *difficulties)
    if categories:
        if "unknown" in categories:
            rest = [c for c in categories if c != "unknown"]
            if rest:
                placeholders = ", ".join("?" * len(rest))
                add(f"(p.category IS NULL OR p.category IN ({placeholders}))", *rest)
            else:
                add("p.category IS NULL")
        else:
            placeholders = ", ".join("?" * len(categories))
            add(f"p.category IN ({placeholders})", *categories)
    if has_statement:
        add("c.statement_markdown IS NOT NULL AND trim(c.statement_markdown) <> ''")
    if has_examples:
        add("EXISTS (SELECT 1 FROM problem_example e WHERE e.content_id = c.id)")

    where_sql = " AND ".join(where)
    base = ("FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1")

    with closing(connect_ro(db)) as conn:
        total = conn.execute(
            f"SELECT COUNT(*) {base} WHERE {where_sql}", params).fetchone()[0]
        offset = (page - 1) * page_size
        rows = conn.execute(
            f"SELECT p.id, i.site, i.slug, i.display_id, p.difficulty, p.category, "
            f"p.is_paid_only, c.locale, c.title, c.revision, "
            f"length(c.statement_markdown) AS statement_chars "
            f"{base} WHERE {where_sql} "
            f"ORDER BY {ORDER_BY[sort]} LIMIT ? OFFSET ?",
            params + [page_size, offset]).fetchall()
        ids = [row["id"] for row in rows]
        tags_map: dict[int, dict[str, str]] = {}
        langs_map: dict[int, list[str]] = {}
        examples_set: set[int] = set()
        if ids:
            placeholders = ", ".join("?" * len(ids))
            for r in conn.execute(
                    f"SELECT pt.problem_id, t.code, t.name FROM problem_tag pt "
                    f"JOIN tag t ON t.id = pt.tag_id WHERE pt.problem_id IN ({placeholders})",
                    ids):
                tags_map.setdefault(r["problem_id"], {})[r["code"]] = r["name"]
            for r in conn.execute(
                    f"SELECT problem_id, language FROM starter_code "
                    f"WHERE is_current = 1 AND problem_id IN ({placeholders})",
                    ids):
                langs_map.setdefault(r["problem_id"], []).append(r["language"])
            for r in conn.execute(
                    f"SELECT DISTINCT i.problem_id FROM problem_example e "
                    f"JOIN problem_content c ON c.id = e.content_id "
                    f"JOIN problem_source_identity i ON i.id = c.source_identity_id "
                    f"WHERE c.is_current = 1 AND i.problem_id IN ({placeholders})",
                    ids):
                examples_set.add(r["problem_id"])

    items = []
    for row in rows:
        tags = sorted(tags_map.get(row["id"], {}))
        items.append({
            "site": row["site"],
            "slug": row["slug"],
            "display_id": row["display_id"],
            "title": row["title"],
            "difficulty": row["difficulty"],
            "category": row["category"],
            "is_paid_only": row["is_paid_only"],
            "locale": row["locale"],
            "revision": row["revision"],
            "statement_chars": row["statement_chars"],
            "has_statement": bool(row["statement_chars"]),
            "has_examples": row["id"] in examples_set,
            "starter_languages": sorted(set(langs_map.get(row["id"], []))),
            "tags": tags,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": items}


def api_problem(db: Path, site: str, slug: str, locale: str | None) -> dict | None:
    if site not in SITES:
        raise ValueError("site must be leetcode.com or leetcode.cn")
    if not SLUG_RE.fullmatch(slug):
        raise ValueError("invalid slug")
    if locale is None:
        locale = "en" if site == "leetcode.com" else "zh-CN"
    if locale not in LOCALES:
        raise ValueError("locale must be en or zh-CN")

    with closing(connect_ro(db)) as conn:
        ident = conn.execute(
            "SELECT i.*, p.difficulty, p.category, p.is_paid_only "
            "FROM problem_source_identity i JOIN problem p ON p.id = i.problem_id "
            "WHERE i.site = ? AND i.slug = ?", (site, slug)).fetchone()
        if ident is None:
            return None
        content = conn.execute(
            "SELECT * FROM problem_content "
            "WHERE source_identity_id = ? AND locale = ? AND is_current = 1",
            (ident["id"], locale)).fetchone()
        if content is None:
            return None
        history = conn.execute(
            "SELECT COUNT(*) FROM problem_content "
            "WHERE source_identity_id = ? AND locale = ?",
            (ident["id"], locale)).fetchone()[0]
        other_locale = conn.execute(
            "SELECT 1 FROM problem_content "
            "WHERE source_identity_id = ? AND locale <> ? AND is_current = 1 LIMIT 1",
            (ident["id"], locale)).fetchone() is not None
        other_site = conn.execute(
            "SELECT site FROM problem_source_identity "
            "WHERE display_id = ? AND display_id IS NOT NULL AND site <> ? LIMIT 1",
            (ident["display_id"], site)).fetchone()
        examples = [dict(r) for r in conn.execute(
            "SELECT ordinal, input_text, output_text, explanation, images_json "
            "FROM problem_example WHERE content_id = ? ORDER BY ordinal",
            (content["id"],))]
        hints = [dict(r) for r in conn.execute(
            "SELECT ordinal, body FROM problem_hint "
            "WHERE content_id = ? AND locale = ? ORDER BY ordinal",
            (content["id"], locale))]
        starters = [dict(r) for r in conn.execute(
            "SELECT language, language_name, template, suspected_implementation "
            "FROM starter_code WHERE problem_id = ? AND is_current = 1 ORDER BY language",
            (ident["problem_id"],))]
        tags = {}
        for r in conn.execute(
                "SELECT t.code, t.name FROM problem_tag pt JOIN tag t ON t.id = pt.tag_id "
                "WHERE pt.problem_id = ? ORDER BY t.name", (ident["problem_id"],)):
            tags.setdefault(r["code"], r["name"])
        provenance = [dict(r) for r in conn.execute(
            "SELECT cp.extract_locator, sr.source_name, sr.repo_path, sr.git_commit, "
            "sr.retrieved_at FROM content_provenance cp "
            "JOIN source_record sr ON sr.id = cp.source_record_id "
            "WHERE cp.object_type = 'content' AND cp.object_id = ?",
            (content["id"],))]
        issues = [dict(r) for r in conn.execute(
            "SELECT issue_type, severity, status, detail_json "
            "FROM data_issue WHERE problem_id = ? ORDER BY issue_type",
            (ident["problem_id"],))]

    statement = content["statement_markdown"]
    has_statement = bool(statement and statement.strip())
    return {
        "problem": {
            "site": ident["site"],
            "slug": ident["slug"],
            "display_id": ident["display_id"],
            "url": ident["url"],
            "difficulty": ident["difficulty"],
            "category": ident["category"],
            "is_paid_only": ident["is_paid_only"],
        },
        "content": {
            "locale": content["locale"],
            "title": content["title"],
            "statement_markdown": statement,
            "format": content["statement_format"],
            "revision": content["revision"],
            "history_versions": history,
            "extraction_status": content["extraction_status"],
            "field_status": json.loads(content["field_status_json"] or "{}"),
            "constraints": json.loads(content["constraints_json"] or "[]"),
            "follow_ups": json.loads(content["follow_ups_json"] or "[]"),
            "coverage": {
                "statement": has_statement,
                "examples": len(examples) > 0,
                "hints": len(hints) > 0,
                "starter_code": len(starters) > 0,
            },
        },
        "examples": [
            {**{k: v for k, v in ex.items() if k != "images_json"},
             "images": json.loads(ex["images_json"] or "[]")}
            for ex in examples
        ],
        "hints": hints,
        "starter_code": starters,
        "tags": sorted(tags),
        "provenance": provenance,
        "alternates": {
            "same_problem_other_locale": other_locale,
            "other_site_same_display_id": other_site["site"] if other_site else None,
        },
        "issues": [
            {"issue_type": it["issue_type"], "severity": it["severity"],
             "status": it["status"],
             "message": (json.loads(it["detail_json"] or "{}").get("message"))}
            for it in issues
        ],
    }


VERSION_SOURCE_JOIN = (
    "LEFT JOIN content_provenance cp ON cp.object_type = 'content' AND cp.object_id = pc.id "
    "LEFT JOIN source_record sr ON sr.id = cp.source_record_id"
)


def api_problem_versions(db: Path, site: str, slug: str, locale: str | None,
                         version: int | None) -> dict | None:
    """List alternate-source statement versions, or fetch one full version."""
    if site not in SITES:
        raise ValueError("site must be leetcode.com or leetcode.cn")
    if not SLUG_RE.fullmatch(slug):
        raise ValueError("invalid slug")
    if locale is None:
        locale = "en" if site == "leetcode.com" else "zh-CN"
    if locale not in LOCALES:
        raise ValueError("locale must be en or zh-CN")

    with closing(connect_ro(db)) as conn:
        ident = conn.execute(
            "SELECT id FROM problem_source_identity WHERE site = ? AND slug = ?",
            (site, slug)).fetchone()
        if ident is None:
            return None
        if version is None:
            rows = conn.execute(
                "SELECT pc.id, pc.revision, pc.is_current, pc.title, "
                "length(pc.statement_markdown) AS statement_chars, "
                "pc.extraction_status, sr.source_name "
                f"FROM problem_content pc {VERSION_SOURCE_JOIN} "
                "WHERE pc.source_identity_id = ? AND pc.locale = ? "
                "ORDER BY pc.is_current DESC, sr.source_name",
                (ident["id"], locale)).fetchall()
            return {"locale": locale, "versions": [dict(r) for r in rows]} if rows else None
        row = conn.execute(
            "SELECT pc.* FROM problem_content pc "
            "WHERE pc.id = ? AND pc.source_identity_id = ? AND pc.locale = ?",
            (version, ident["id"], locale)).fetchone()
        if row is None:
            return None
        examples = [dict(r) for r in conn.execute(
            "SELECT ordinal, input_text, output_text, explanation, images_json "
            "FROM problem_example WHERE content_id = ? ORDER BY ordinal",
            (row["id"],))]
        provenance = conn.execute(
            "SELECT sr.source_name, sr.repo_path, sr.git_commit, sr.retrieved_at, "
            "cp.extract_locator "
            "FROM content_provenance cp "
            "LEFT JOIN source_record sr ON sr.id = cp.source_record_id "
            "WHERE cp.object_type = 'content' AND cp.object_id = ?",
            (row["id"],)).fetchall()

    statement = row["statement_markdown"]
    return {
        "version": {
            "id": row["id"],
            "revision": row["revision"],
            "is_current": bool(row["is_current"]),
            "title": row["title"],
            "statement_markdown": statement,
            "statement_format": row["statement_format"],
            "extraction_status": row["extraction_status"],
            "constraints": json.loads(row["constraints_json"] or "[]"),
            "follow_ups": json.loads(row["follow_ups_json"] or "[]"),
            "examples": [
                {**{k: v for k, v in ex.items() if k != "images_json"},
                 "images": json.loads(ex["images_json"] or "[]")}
                for ex in examples
            ],
            "provenance": [dict(r) for r in provenance],
        },
    }


ISSUE_TYPES = {"content_conflict", "difficulty_conflict", "identity_field_mismatch",
               "paid_statement_absent", "statement_missing"}
SEVERITIES = {"info", "warning"}
STATUSES = {"open", "resolved", "wontfix"}

CURRENT_CONTENT = ("JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
                   "JOIN problem p ON p.id = i.problem_id")


def api_stats(db: Path) -> dict:
    with closing(connect_ro(db)) as conn:
        com, cn = 0, 0
        for r in conn.execute("SELECT site, COUNT(*) AS n FROM problem_source_identity GROUP BY site"):
            if r["site"] == "leetcode.com":
                com = r["n"]
            elif r["site"] == "leetcode.cn":
                cn = r["n"]
        premium = conn.execute("SELECT COUNT(*) FROM problem WHERE is_paid_only = 1").fetchone()[0]
        contents = conn.execute("SELECT COUNT(*) FROM problem_content").fetchone()[0]
        examples_total = conn.execute("SELECT COUNT(*) FROM problem_example").fetchone()[0]
        issues_total = conn.execute("SELECT COUNT(*) FROM data_issue").fetchone()[0]
        by_difficulty = {r["difficulty"]: r["n"] for r in conn.execute(
            "SELECT difficulty, COUNT(*) AS n FROM problem "
            "WHERE difficulty IS NOT NULL GROUP BY difficulty")}
        by_category = {r["category"]: r["n"] for r in conn.execute(
            "SELECT COALESCE(category, 'unknown') AS category, COUNT(*) AS n "
            "FROM problem GROUP BY 1")}
        issues_by_type = {r["issue_type"]: r["n"] for r in conn.execute(
            "SELECT issue_type, COUNT(*) AS n FROM data_issue GROUP BY issue_type")}
        with_statement = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "WHERE p.is_paid_only = 1 AND trim(c.statement_markdown) <> ''").fetchone()[0]
        with_examples = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "WHERE p.is_paid_only = 1 AND EXISTS "
            "(SELECT 1 FROM problem_example e WHERE e.content_id = c.id)").fetchone()[0]
        example_count = conn.execute(
            "SELECT COUNT(*) FROM problem_example e "
            "JOIN problem_content c ON c.id = e.content_id "
            "JOIN problem_source_identity i ON i.id = c.source_identity_id "
            "JOIN problem p ON p.id = i.problem_id "
            "WHERE p.is_paid_only = 1 AND c.is_current = 1").fetchone()[0]
        with_hints = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "WHERE p.is_paid_only = 1 AND EXISTS "
            "(SELECT 1 FROM problem_hint h WHERE h.content_id = c.id)").fetchone()[0]
        with_starter = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "WHERE p.is_paid_only = 1 AND EXISTS "
            "(SELECT 1 FROM starter_code s WHERE s.problem_id = p.id AND s.is_current = 1)"
        ).fetchone()[0]
        generated_at = conn.execute("SELECT MAX(finished_at) FROM import_batch").fetchone()[0]
    return {
        "generated_at": generated_at,
        "totals": {"problems": com + cn, "com": com, "cn": cn, "premium": premium,
                   "contents": contents, "examples": examples_total, "issues": issues_total},
        "by_difficulty": by_difficulty,
        "by_category": by_category,
        "premium": {"total": premium, "with_statement": with_statement,
                    "with_examples": with_examples, "example_count": example_count,
                    "with_hints": with_hints, "with_starter_code": with_starter},
        "issues_by_type": issues_by_type,
    }


def api_premium_summary(db: Path) -> dict:
    with closing(connect_ro(db)) as conn:
        total, with_statement = conn.execute(
            "SELECT COUNT(*), SUM(CASE WHEN trim(c.statement_markdown) <> '' THEN 1 ELSE 0 END) "
            "FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "WHERE p.is_paid_only = 1").fetchone()
        with_examples = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "WHERE p.is_paid_only = 1 AND EXISTS "
            "(SELECT 1 FROM problem_example e WHERE e.content_id = c.id)").fetchone()[0]
        example_count = conn.execute(
            "SELECT COUNT(*) FROM problem_example e "
            "JOIN problem_content c ON c.id = e.content_id "
            "JOIN problem_source_identity i ON i.id = c.source_identity_id "
            "JOIN problem p ON p.id = i.problem_id "
            "WHERE p.is_paid_only = 1 AND c.is_current = 1").fetchone()[0]
        with_hints = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "WHERE p.is_paid_only = 1 AND EXISTS "
            "(SELECT 1 FROM problem_hint h WHERE h.content_id = c.id)").fetchone()[0]
        with_starter = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "WHERE p.is_paid_only = 1 AND EXISTS "
            "(SELECT 1 FROM starter_code s WHERE s.problem_id = p.id AND s.is_current = 1)"
        ).fetchone()[0]
        free_total = conn.execute(
            "SELECT COUNT(DISTINCT p.id) FROM problem p "
            "JOIN problem_source_identity i ON i.problem_id = p.id "
            "WHERE p.is_paid_only = 0 AND i.site = 'leetcode.com'").fetchone()[0]
        unknown_total = conn.execute(
            "SELECT COUNT(*) FROM problem WHERE is_paid_only IS NULL").fetchone()[0]
        by_difficulty = {
            row["difficulty"]: row["n"] for row in conn.execute(
                "SELECT difficulty, COUNT(*) AS n FROM problem "
                "WHERE is_paid_only = 1 AND difficulty IS NOT NULL "
                "GROUP BY difficulty")}
        by_category = {
            row["category"]: row["n"] for row in conn.execute(
                "SELECT category, COUNT(*) AS n FROM problem "
                "WHERE is_paid_only = 1 AND category IS NOT NULL "
                "GROUP BY category ORDER BY n DESC, category")}
        top_tags = [
            {"code": row["code"], "count": row["n"]} for row in conn.execute(
                "SELECT t.code, COUNT(DISTINCT p.id) AS n FROM problem p "
                "JOIN problem_tag pt ON pt.problem_id = p.id "
                "JOIN tag t ON t.id = pt.tag_id "
                "WHERE p.is_paid_only = 1 "
                "GROUP BY t.code ORDER BY n DESC, t.code LIMIT 14")]
        generated_at = conn.execute("SELECT MAX(finished_at) FROM import_batch").fetchone()[0]
    return {
        "site": "leetcode.com",
        "total": total,
        "with_statement": with_statement,
        "with_examples": with_examples,
        "example_count": example_count,
        "with_hints": with_hints,
        "with_starter_code": with_starter,
        "free_total": free_total,
        "unknown_total": unknown_total,
        "by_difficulty": by_difficulty,
        "by_category": by_category,
        "top_tags": top_tags,
        "source_note": "会员标记来自 leetcode.com；题干来自 doocs 公开快照。",
        "generated_at": generated_at,
    }


def api_issues(db: Path, query: dict) -> dict:
    issue_type = query.get("type", [""])[0] or None
    if issue_type is not None and issue_type not in ISSUE_TYPES:
        raise ValueError("unknown issue type")
    severity = query.get("severity", [""])[0] or None
    if severity is not None and severity not in SEVERITIES:
        raise ValueError("severity must be info or warning")
    status = query.get("status", [""])[0] or None
    if status is not None and status not in STATUSES:
        raise ValueError("unknown status")
    try:
        page = int(query.get("page", ["1"])[0])
        page_size = min(int(query.get("page_size", ["20"])[0]), 100)
    except ValueError:
        raise ValueError("page and page_size must be integers") from None
    if page < 1 or page_size < 1:
        raise ValueError("page and page_size must be >= 1")

    where = []
    params: list = []
    if issue_type:
        where.append("d.issue_type = ?")
        params.append(issue_type)
    if severity:
        where.append("d.severity = ?")
        params.append(severity)
    if status:
        where.append("d.status = ?")
        params.append(status)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    with closing(connect_ro(db)) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM data_issue d {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT d.id, d.issue_type, d.severity, d.status, d.detail_json, d.problem_id "
            f"FROM data_issue d {where_sql} ORDER BY d.id LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size]).fetchall()
        problems: dict[int, dict] = {}
        ids = [r["problem_id"] for r in rows if r["problem_id"] is not None]
        if ids:
            placeholders = ", ".join("?" * len(ids))
            for r in conn.execute(
                    f"SELECT i.problem_id, i.site, i.slug, i.display_id, c.title, c.locale "
                    f"FROM problem_source_identity i {CURRENT_CONTENT} "
                    f"WHERE i.problem_id IN ({placeholders})", ids):
                if r["problem_id"] not in problems or (
                        r["site"] == "leetcode.com" and r["locale"] == "en"
                        and not (problems[r["problem_id"]]["site"] == "leetcode.com"
                                 and problems[r["problem_id"]]["locale"] == "en")):
                    problems[r["problem_id"]] = {
                        "site": r["site"], "slug": r["slug"], "display_id": r["display_id"],
                        "title": r["title"], "locale": r["locale"],
                    }

    items = []
    for row in rows:
        detail = json.loads(row["detail_json"]) if row["detail_json"] else {}
        items.append({
            "id": row["id"],
            "issue_type": row["issue_type"],
            "severity": row["severity"],
            "status": row["status"],
            "message": detail.get("message"),
            "detail": detail.get("detail"),
            "problem": problems.get(row["problem_id"]),
        })
    return {"total": total, "page": page, "page_size": page_size, "items": items}


def _random_row(db: Path, where_sql: str, params: list, offset_sql: str, offset: int | None) -> dict:
    with closing(connect_ro(db)) as conn:
        sql = (f"SELECT i.site, i.slug, i.display_id, c.title, c.locale, p.difficulty, "
               f"p.is_paid_only "
               f"FROM problem_source_identity i {CURRENT_CONTENT} "
               f"WHERE c.is_current = 1 {where_sql} {offset_sql}")
        row = conn.execute(sql, params if offset is None else params + [offset]).fetchone()
    if row is None:
        return {}
    return {key: row[key] for key in row.keys()}


PAIRS_FILE = ROOT / "reports" / "cross-site-candidates.jsonl"
_pairs_cache: list | None = None


def _load_pairs() -> list:
    global _pairs_cache
    if _pairs_cache is None:
        pairs = []
        if PAIRS_FILE.is_file():
            with open(PAIRS_FILE, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line:
                        pairs.append(json.loads(line))
        _pairs_cache = pairs
    return _pairs_cache


def _pair_titles(db: Path, pairs: list) -> dict[int, dict]:
    ids = []
    for pair in pairs:
        ids.extend([pair["leetcode_com_problem_id"], pair["leetcode_cn_problem_id"]])
    info: dict[int, dict] = {}
    if ids:
        placeholders = ", ".join("?" * len(ids))
        with closing(connect_ro(db)) as conn:
            for r in conn.execute(
                    f"SELECT p.id, p.difficulty, i.site, i.slug, c.title "
                    f"FROM problem p "
                    f"JOIN problem_source_identity i ON i.problem_id = p.id "
                    f"JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
                    f"WHERE p.id IN ({placeholders})", ids):
                info[r["id"]] = {
                    "title": r["title"], "difficulty": r["difficulty"],
                    "site": r["site"], "slug": r["slug"],
                }
    return info


def _pair_items(pairs: list, info: dict[int, dict]) -> list:
    items = []
    for pair in pairs:
        com = info.get(pair["leetcode_com_problem_id"])
        cn = info.get(pair["leetcode_cn_problem_id"])
        items.append({
            "slug": pair["slug"],
            "display_id": pair["display_id"],
            "status": pair.get("status"),
            "com": {"title": com["title"], "difficulty": com["difficulty"],
                    "slug": com["slug"]} if com else None,
            "cn": {"title": cn["title"], "difficulty": cn["difficulty"],
                   "slug": cn["slug"]} if cn else None,
        })
    return items


def api_pairs_all() -> dict:
    """Lightweight full list of pairing candidates (metadata only)."""
    pairs = _load_pairs()
    return {"total": len(pairs), "items": [
        {"slug": p["slug"], "display_id": p["display_id"]} for p in pairs
    ]}


def api_pairs(db: Path, query: dict) -> dict:
    """Pairing candidates with titles; filter by q, page, or ids (max 100)."""
    q = (query.get("q", [""])[0] or "").strip()[:100]
    ids_param = (query.get("ids", [""])[0] or "").strip()
    pairs = _load_pairs()
    if ids_param:
        wanted = [part.strip() for part in ids_param.split(",") if part.strip()]
        if not wanted or len(wanted) > 100 or any(len(i) > 100 for i in wanted):
            raise ValueError("ids must be 1-100 comma separated display ids")
        wanted_set = set(wanted)
        pairs = [p for p in pairs if p["display_id"] in wanted_set]
        return {"total": len(pairs), "items": _pair_items(pairs, _pair_titles(db, pairs))}

    try:
        page = int(query.get("page", ["1"])[0])
        page_size = min(int(query.get("page_size", ["20"])[0]), 100)
    except ValueError:
        raise ValueError("page and page_size must be integers") from None
    if page < 1 or page_size < 1:
        raise ValueError("page and page_size must be >= 1")

    if q:
        needle = q.lower()
        pairs = [p for p in pairs
                 if needle in p["slug"] or p["display_id"] == q or p["display_id"] == q.lstrip("#")]
    total = len(pairs)
    offset = (page - 1) * page_size
    rows = pairs[offset:offset + page_size]
    return {"total": total, "page": page, "page_size": page_size,
            "items": _pair_items(rows, _pair_titles(db, rows))}


def api_tags_by_keys(db: Path, query: dict) -> dict:
    """Batch tag lookup by "site:slug:locale" keys (max 100)."""
    raw = (query.get("keys", [""])[0] or "").strip()
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys or len(keys) > 100 or any(len(k) > 200 for k in keys):
        raise ValueError("keys must be 1-100 comma separated site:slug:locale entries")
    parsed = []
    for key in keys:
        parts = key.split(":")
        if len(parts) != 3:
            raise ValueError(f"invalid key: {key}")
        site, slug, _locale = parts
        if site not in SITES or not SLUG_RE.fullmatch(slug):
            raise ValueError(f"invalid key: {key}")
        parsed.append((key, site, slug))
    tags: dict[str, list] = {key: [] for key in keys}
    with closing(connect_ro(db)) as conn:
        for key, site, slug in parsed:
            rows = conn.execute(
                "SELECT t.code FROM problem_tag pt "
                "JOIN tag t ON t.id = pt.tag_id "
                "JOIN problem_source_identity i ON i.problem_id = pt.problem_id "
                "WHERE i.site = ? AND i.slug = ?", (site, slug)).fetchall()
            tags[key] = sorted({r["code"] for r in rows})
    return {"tags": tags}


def api_random(db: Path, query: dict) -> dict:
    site = query.get("site", [""])[0] or None
    if site is not None and site not in SITES:
        raise ValueError("site must be leetcode.com or leetcode.cn")
    locale = query.get("locale", [""])[0] or None
    if locale is not None and locale not in LOCALES:
        raise ValueError("locale must be en or zh-CN")
    difficulty = query.get("difficulty", [""])[0] or None
    if difficulty is not None and difficulty not in DIFFICULTIES:
        raise ValueError("invalid difficulty")
    category = query.get("category", [""])[0] or None
    if category is not None and category not in CATEGORIES:
        raise ValueError("invalid category")
    paid = query.get("paid", [""])[0] or None
    if paid is not None and paid not in PAID_VALUES:
        raise ValueError("paid must be 1, 0 or unknown")
    where = []
    params = []
    if site:
        where.append("AND i.site = ?")
        params.append(site)
    if locale:
        where.append("AND c.locale = ?")
        params.append(locale)
    if difficulty:
        where.append("AND p.difficulty = ?")
        params.append(difficulty)
    if category:
        if category == "unknown":
            where.append("AND p.category IS NULL")
        else:
            where.append("AND p.category = ?")
            params.append(category)
    if paid == "1":
        where.append("AND p.is_paid_only = 1")
    elif paid == "0":
        where.append("AND p.is_paid_only = 0")
    elif paid == "unknown":
        where.append("AND p.is_paid_only IS NULL")
    result = _random_row(db, " ".join(where), params, "ORDER BY RANDOM() LIMIT 1", None)
    return {"random": result} if result else {"random": None}


def api_daily(db: Path) -> dict:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    with closing(connect_ro(db)) as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM problem_content WHERE is_current = 1").fetchone()[0]
    offset = int(today) % total if total else 0
    result = _random_row(db, "", [], "ORDER BY c.id LIMIT 1 OFFSET ?", offset)
    return {"date": today, "total": total, "daily": result}


AUTH_ERROR_STATUS = {
    "用户名或密码不正确": 401,
    "用户名已存在": 409,
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "qb-web/0.1"
    db_path: Path = DB_DEFAULT
    auth_db_path: Path = AUTH_DB

    def do_GET(self):  # noqa: N802
        path = urlsplit(self.path).path
        try:
            if path == "/api/health":
                self._json(api_health(self.db_path))
            elif path == "/api/auth/me":
                self._json(self._auth_me())
            elif path == "/api/meta":
                self._json(api_meta(self.db_path))
            elif path == "/api/problems":
                self._json(api_problems(self.db_path, parse_qs(urlsplit(self.path).query)))
            elif path == "/api/stats":
                self._json(api_stats(self.db_path))
            elif path == "/api/premium/summary":
                self._json(api_premium_summary(self.db_path))
            elif path == "/api/issues":
                self._json(api_issues(self.db_path, parse_qs(urlsplit(self.path).query)))
            elif path == "/api/pairs/all":
                self._json(api_pairs_all())
            elif path == "/api/pairs":
                self._json(api_pairs(self.db_path, parse_qs(urlsplit(self.path).query)))
            elif path == "/api/tags/by-slugs":
                self._json(api_tags_by_keys(self.db_path, parse_qs(urlsplit(self.path).query)))
            elif path == "/api/random":
                self._json(api_random(self.db_path, parse_qs(urlsplit(self.path).query)))
            elif path == "/api/daily":
                self._json(api_daily(self.db_path))
            elif match := re.fullmatch(r"/api/problems/([^/]+)/([^/]+)/versions", path):
                query = parse_qs(urlsplit(self.path).query)
                locale = query.get("locale", [""])[0] or None
                version = None
                if query.get("version", [""])[0]:
                    try:
                        version = int(query["version"][0])
                    except ValueError:
                        raise ValueError("version must be an integer") from None
                    if version < 1:
                        raise ValueError("version must be >= 1")
                result = api_problem_versions(self.db_path, match.group(1),
                                              match.group(2), locale, version)
                if result is None:
                    self._error(404, "NOT_FOUND",
                                "problem, locale or version not found")
                else:
                    self._json(result)
            elif match := re.fullmatch(r"/api/problems/([^/]+)/([^/]+)", path):
                query = parse_qs(urlsplit(self.path).query)
                result = api_problem(self.db_path, match.group(1), match.group(2),
                                     query.get("locale", [""])[0] or None)
                if result is None:
                    self._error(404, "NOT_FOUND", "problem or locale not found")
                else:
                    self._json(result)
            elif path.startswith("/api/"):
                self._error(404, "NOT_FOUND", "unknown API path")
            else:
                self._static(path)
        except ValueError as exc:
            self._error(400, "BAD_REQUEST", str(exc))
        except sqlite3.Error as exc:
            self._error(500, "DB_ERROR", str(exc))

    def _method_not_allowed(self) -> None:
        self._error(405, "METHOD_NOT_ALLOWED", "GET and HEAD only")

    do_HEAD = do_GET  # noqa: N815
    do_PUT = _method_not_allowed  # noqa: N815
    do_DELETE = _method_not_allowed  # noqa: N815
    do_PATCH = _method_not_allowed  # noqa: N815

    # ---- 认证（独立 users 数据库；题库连接不受影响） ----

    def _read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("invalid Content-Length") from None
        if length <= 0 or length > 10_000:
            raise ValueError("request body must be 1-10000 bytes")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("body must be valid JSON") from None
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        return payload

    def _session_token(self) -> str:
        header = self.headers.get("Cookie", "")
        for part in header.split(";"):
            name, _, value = part.strip().partition("=")
            if name == SESSION_COOKIE and value:
                return value
        return ""

    def _session_cookie(self, token: str, expires: datetime) -> str:
        max_age = max(1, int(SESSION_TTL.total_seconds()))
        return (f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; "
                f"Max-Age={max_age}")

    def _auth_me(self) -> dict:
        token = self._session_token()
        with closing(connect_auth(self.auth_db_path)) as conn:
            session = resolve_session(conn, token)
        if session is None:
            return {"authenticated": False, "username": None, "role": "guest"}
        return {"authenticated": True, **session,
                "role_label": ROLE_LABELS.get(session["role"], session["role"])}

    def _handle_register(self, body: dict):
        with closing(connect_auth(self.auth_db_path)) as conn:
            user = create_user(conn, body.get("username", ""), body.get("password", ""),
                               role="user")
            token, expires = create_session(conn, user["username"])
        return {"ok": True, "user": user}, [("Set-Cookie", self._session_cookie(token, expires))]

    def _handle_login(self, body: dict):
        with closing(connect_auth(self.auth_db_path)) as conn:
            user = authenticate(conn, body.get("username", ""), body.get("password", ""))
            token, expires = create_session(conn, user["username"])
        return {"ok": True, "user": user}, [("Set-Cookie", self._session_cookie(token, expires))]

    def _handle_logout(self, body: dict):
        with closing(connect_auth(self.auth_db_path)) as conn:
            drop_session(conn, self._session_token())
        clear = f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
        return {"ok": True}, [("Set-Cookie", clear)]

    def do_POST(self):  # noqa: N802
        path = urlsplit(self.path).path
        handlers = {
            "/api/auth/register": self._handle_register,
            "/api/auth/login": self._handle_login,
            "/api/auth/logout": self._handle_logout,
        }
        try:
            if path not in handlers:
                if path.startswith("/api/"):
                    self._error(405, "METHOD_NOT_ALLOWED", "GET and HEAD only")
                else:
                    self._error(404, "NOT_FOUND", "file not found")
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._error(400, "BAD_REQUEST", str(exc))
                return
            try:
                result, extra_headers = handlers[path](body)
            except AuthError as exc:
                status = AUTH_ERROR_STATUS.get(str(exc), 400)
                self._error(status, "AUTH_ERROR", str(exc))
                return
            self._json(result, extra_headers=extra_headers)
        except sqlite3.Error as exc:
            self._error(500, "DB_ERROR", str(exc))

    def _security(self) -> None:
        for name, value in SECURITY_HEADERS:
            self.send_header(name, value)

    def _json(self, payload: dict, status: int = 200, extra_headers: list | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        if len(body) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body)
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or []):
            self.send_header(name, value)
        self._security()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status: int, code: str, message: str) -> None:
        self._json({"error": {"code": code, "message": message}}, status=status)

    def _static(self, path: str) -> None:
        rel = "index.html" if path in ("", "/") else unquote(path.lstrip("/"))
        target = (STATIC_DIR / rel).resolve()
        if not target.is_relative_to(STATIC_DIR.resolve()) or not target.is_file():
            self._error(404, "NOT_FOUND", "file not found")
            return
        data = target.read_bytes()
        if target.suffix == ".wasm":
            ctype = "application/wasm"
        else:
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or "javascript" in ctype:
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self._security()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        print(f"[qb-web] {self.address_string()} {fmt % args}", flush=True)


def make_server(db: Path, host: str, port: int,
                auth_db: Path | None = None) -> ThreadingHTTPServer:
    attrs = {"db_path": db}
    if auth_db is not None:
        attrs["auth_db_path"] = auth_db
    handler = type("BoundHandler", (Handler,), attrs)
    return ThreadingHTTPServer((host, port), handler)


def main(db: Path = DB_DEFAULT, host: str = "127.0.0.1", port: int = 8000,
         open_browser: bool = False) -> None:
    if not db.is_file():
        raise SystemExit(f"database not found: {db}")
    if host != "127.0.0.1":
        print("warning: serving on a non-loopback host exposes the question bank "
              "to the local network", flush=True)
    created = seed_if_missing()
    if created:
        print(f"[qb-auth] seeded test accounts: {', '.join(created)} "
              f"(passwords: see README 登录与注册)", flush=True)
    httpd = make_server(db, host, port)
    url = f"http://{host}:{port}/"
    print(f"[qb-web] serving {db} at {url}", flush=True)
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print("[qb-web] stopped", flush=True)


if __name__ == "__main__":
    main()
