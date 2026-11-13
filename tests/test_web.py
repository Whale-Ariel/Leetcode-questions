"""API tests for the read-only web server (M0 scope)."""

import http.client
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from qb.auth import connect_auth, ensure_seed_users  # noqa: E402
from qb.server import DB_DEFAULT, api_health, api_meta, connect_ro, make_server  # noqa: E402


class ApiTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._auth_tmp = tempfile.TemporaryDirectory()
        cls.auth_db = Path(cls._auth_tmp.name) / "users.sqlite"
        conn = connect_auth(cls.auth_db)
        ensure_seed_users(conn)
        conn.close()
        cls.server = make_server(DB_DEFAULT, "127.0.0.1", 0, auth_db=cls.auth_db)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls.server.server_close()
        cls._auth_tmp.cleanup()

    def get(self, path, cookie=None):
        headers = {"Cookie": cookie} if cookie else None
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), err.read()

    def raw(self, method, path, headers=None, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(method, path, body=body, headers=headers or {})
        res = conn.getresponse()
        body = res.read().decode("utf-8")
        headers_out = dict(res.getheaders())
        conn.close()
        return res.status, headers_out, body

    def post_json(self, path, payload, cookie=None):
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), err.read()

    @staticmethod
    def cookie_from(headers):
        value = headers.get("Set-Cookie", "")
        return value.split(";")[0] if value.startswith("qb_session=") else None


class HealthMetaTests(ApiTestBase):
    def test_health(self):
        status, _, body = self.get("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True, "problems": 8202, "db": "question-bank.sqlite"})

    def test_health_direct(self):
        result = api_health(DB_DEFAULT)
        self.assertTrue(result["ok"])
        self.assertEqual(result["problems"], 8202)

    def test_meta(self):
        status, _, body = self.get("/api/meta")
        self.assertEqual(status, 200)
        meta = json.loads(body)
        self.assertEqual(meta["sites"], {"leetcode.com": 4101, "leetcode.cn": 4101})
        self.assertEqual(meta["paid"], {"premium": 789, "free": 3312, "unknown": 4101})
        self.assertEqual(meta["difficulties"], {"easy": 1950, "medium": 4278, "hard": 1974})
        self.assertIn("unknown", meta["categories"])
        self.assertIsNotNone(meta["generated_at"])


class StaticAndErrorTests(ApiTestBase):
    def test_index_html(self):
        status, headers, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>LeetCode \xe9\xa2\x98\xe5\xba\x93", body)
        self.assertIn("Content-Security-Policy", headers)
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")

    def test_static_asset(self):
        status, headers, _ = self.get("/css/styles.css")
        self.assertEqual(status, 200)
        self.assertIn("text/css", headers.get("Content-Type", ""))

    def test_unknown_api_path(self):
        status, _, body = self.get("/api/nope")
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body)["error"]["code"], "NOT_FOUND")

    def test_missing_static_file(self):
        status, _, _ = self.get("/missing.js")
        self.assertEqual(status, 404)

    def test_path_traversal(self):
        status, _, _ = self.raw("GET", "/../README.md")
        self.assertEqual(status, 404)
        status, _, _ = self.raw("GET", "/%2e%2e/%2e%2e/README.md")
        self.assertEqual(status, 404)

    def test_method_not_allowed(self):
        status, _, body = self.raw("POST", "/api/health")
        self.assertEqual(status, 405)
        self.assertEqual(json.loads(body)["error"]["code"], "METHOD_NOT_ALLOWED")

    def test_security_headers_on_api_and_errors(self):
        for path in ("/api/health", "/api/nope", "/missing.js"):
            _, headers, _ = self.get(path)
            csp = headers.get("Content-Security-Policy", "")
            self.assertIn("default-src 'self'", csp)
            self.assertIn("frame-ancestors 'none'", csp)
            self.assertIn("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'", csp)
            self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
            self.assertEqual(headers.get("Referrer-Policy"), "no-referrer")

    def test_wasm_served_with_correct_type(self):
        status, headers, _ = self.get("/pyodide/pyodide.asm.wasm")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "application/wasm")

    def test_head_request_has_no_body(self):
        for path in ("/api/health", "/", "/css/styles.css"):
            status, headers, body = self.raw("HEAD", path)
            self.assertEqual(status, 200)
            self.assertEqual(body, "")
            self.assertIn("Content-Length", headers)
            self.assertGreater(int(headers["Content-Length"]), 0)

    def test_db_is_opened_read_only(self):
        # 服务端每个请求都走 query_only 只读连接：写操作必须失败
        conn = connect_ro(DB_DEFAULT)
        try:
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("CREATE TABLE should_fail (id INTEGER)")
        finally:
            conn.close()


class ProblemsApiTests(ApiTestBase):
    def problems(self, params):
        query = urllib.parse.urlencode(params, doseq=True)
        status, _, body = self.get(f"/api/problems?{query}")
        return status, json.loads(body)

    def test_default_page(self):
        status, data = self.problems({})
        self.assertEqual(status, 200)
        self.assertEqual(data["total"], 8202)
        self.assertEqual(data["page"], 1)
        self.assertEqual(data["page_size"], 20)
        self.assertEqual(len(data["items"]), 20)
        first = data["items"][0]
        self.assertEqual(first["display_id"], "1")
        self.assertEqual(first["slug"], "two-sum")
        self.assertEqual(first["difficulty"], "easy")

    def test_slug_prefix_search(self):
        _, data = self.problems({"q": "two-sum"})
        self.assertEqual(data["total"], 12)

    def test_numeric_search(self):
        _, data = self.problems({"q": "#1"})
        self.assertEqual(data["total"], 2)
        self.assertTrue(all(item["display_id"] == "1" for item in data["items"]))

    def test_chinese_title_search(self):
        _, data = self.problems({"q": "两数之和", "site": "leetcode.cn"})
        self.assertEqual(data["total"], 5)
        self.assertTrue(all("两数之和" in item["title"] for item in data["items"]))

    def test_category_and_difficulty(self):
        _, data = self.problems({"category": "database", "difficulty": "easy"})
        self.assertEqual(data["total"], 226)

    def test_paid_filters(self):
        _, premium = self.problems({"paid": "1"})
        self.assertEqual(premium["total"], 789)
        _, free = self.problems({"paid": "0"})
        self.assertEqual(free["total"], 3312)
        _, unknown = self.problems({"paid": "unknown"})
        self.assertEqual(unknown["total"], 4101)

    def test_paid_invalid(self):
        status, data = self.problems({"paid": "2"})
        self.assertEqual(status, 400)
        self.assertEqual(data["error"]["code"], "BAD_REQUEST")

    def test_page_size_clamped(self):
        _, data = self.problems({"page_size": "1000"})
        self.assertEqual(data["page_size"], 100)
        self.assertEqual(len(data["items"]), 100)

    def test_page_zero_invalid(self):
        status, data = self.problems({"page": "0"})
        self.assertEqual(status, 400)

    def test_pagination_page2(self):
        _, data = self.problems({"page": "2"})
        self.assertEqual(data["page"], 2)
        self.assertEqual(data["items"][0]["display_id"], "11")

    def test_sort_difficulty(self):
        _, data = self.problems({"sort": "difficulty"})
        self.assertEqual(data["items"][0]["difficulty"], "easy")

    def test_sort_invalid(self):
        status, data = self.problems({"sort": "hacked"})
        self.assertEqual(status, 400)

    def test_injection_attempt(self):
        _, data = self.problems({"q": "' OR 1=1--"})
        self.assertEqual(data["total"], 0)

    def test_has_statement(self):
        _, data = self.problems({"has_statement": "1"})
        self.assertEqual(data["total"], 8202)

    def test_search_in_statements(self):
        _, data = self.problems({"q": "indices of the two numbers", "search_in": "all"})
        self.assertGreaterEqual(data["total"], 2)

    def test_gzip_response(self):
        import gzip
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", "/api/problems?page_size=100", headers={"Accept-Encoding": "gzip"})
        res = conn.getresponse()
        body = res.read()
        headers = dict(res.getheaders())
        conn.close()
        self.assertEqual(res.status, 200)
        self.assertEqual(headers.get("Content-Encoding"), "gzip")
        data = json.loads(gzip.decompress(body))
        self.assertEqual(data["total"], 8202)
        self.assertEqual(len(data["items"]), 100)


class DetailApiTests(ApiTestBase):
    def detail(self, path):
        status, _, body = self.get(path)
        return status, json.loads(body)

    def test_two_sum_detail(self):
        status, data = self.detail("/api/problems/leetcode.com/two-sum")
        self.assertEqual(status, 200)
        self.assertEqual(data["problem"]["site"], "leetcode.com")
        self.assertEqual(data["problem"]["slug"], "two-sum")
        self.assertEqual(data["problem"]["display_id"], "1")
        self.assertEqual(data["problem"]["difficulty"], "easy")
        self.assertEqual(data["content"]["locale"], "en")
        self.assertEqual(data["content"]["title"], "Two Sum")
        self.assertIn("indices of the two numbers", data["content"]["statement_markdown"])
        self.assertEqual(len(data["examples"]), 3)
        self.assertEqual(data["examples"][0]["input_text"], "nums = [2,7,11,15], target = 9")
        self.assertEqual(data["examples"][0]["images"], [])
        self.assertGreaterEqual(len(data["hints"]), 3)
        self.assertGreaterEqual(len(data["starter_code"]), 19)
        self.assertEqual(data["tags"], ["array", "hash-table"])
        self.assertEqual(data["alternates"]["other_site_same_display_id"], "leetcode.cn")
        self.assertGreaterEqual(data["content"]["history_versions"], 1)
        self.assertGreaterEqual(data["content"]["revision"], 1)
        self.assertTrue(data["content"]["coverage"]["statement"])

    def test_default_locale_cn(self):
        status, data = self.detail("/api/problems/leetcode.cn/two-sum")
        self.assertEqual(status, 200)
        self.assertEqual(data["content"]["locale"], "zh-CN")
        self.assertEqual(data["content"]["title"], "两数之和")

    def test_missing_locale(self):
        status, data = self.detail("/api/problems/leetcode.cn/two-sum?locale=en")
        self.assertEqual(status, 404)
        self.assertEqual(data["error"]["code"], "NOT_FOUND")

    def test_not_found(self):
        status, data = self.detail("/api/problems/leetcode.com/no-such-problem-xyz")
        self.assertEqual(status, 404)

    def test_invalid_site(self):
        status, data = self.detail("/api/problems/foo.com/two-sum")
        self.assertEqual(status, 400)

    def test_invalid_slug(self):
        status, _ = self.detail("/api/problems/leetcode.com/two%20sum")
        self.assertEqual(status, 400)

    def test_premium_detail(self):
        status, data = self.detail("/api/problems/leetcode.com/binary-tree-upside-down")
        self.assertEqual(status, 200)
        self.assertEqual(data["problem"]["is_paid_only"], 1)
        self.assertTrue(data["content"]["title"].endswith("🔒"))
        self.assertTrue(any(p["source_name"] == "doocs" for p in data["provenance"]))
        self.assertEqual(data["content"]["history_versions"], 2)
        self.assertTrue(data["content"]["coverage"]["statement"])


class AuthApiTests(ApiTestBase):
    def test_me_without_cookie(self):
        status, _, body = self.get("/api/auth/me")
        self.assertEqual(status, 200)
        me = json.loads(body)
        self.assertFalse(me["authenticated"])
        self.assertEqual(me["role"], "guest")

    def test_login_seeded_accounts(self):
        for username, password, role in (
                ("guest", "guest123456", "guest"),
                ("user", "user123456", "user"),
                ("premium", "premium123456", "premium")):
            status, headers, body = self.post_json(
                "/api/auth/login", {"username": username, "password": password})
            self.assertEqual(status, 200, username)
            data = json.loads(body)
            self.assertEqual(data["user"]["role"], role)
            cookie = self.cookie_from(headers)
            self.assertIsNotNone(cookie)
            set_cookie = headers.get("Set-Cookie", "")
            self.assertIn("HttpOnly", set_cookie)
            self.assertIn("SameSite=Strict", set_cookie)
            status, _, body = self.get("/api/auth/me", cookie=cookie)
            me = json.loads(body)
            self.assertTrue(me["authenticated"])
            self.assertEqual(me["username"], username)
            self.assertEqual(me["role"], role)

    def test_login_wrong_password(self):
        status, _, body = self.post_json(
            "/api/auth/login", {"username": "premium", "password": "wrong-pass"})
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body)["error"]["code"], "AUTH_ERROR")

    def test_login_unknown_user(self):
        status, _, _ = self.post_json(
            "/api/auth/login", {"username": "no-such-user", "password": "whatever123"})
        self.assertEqual(status, 401)

    def test_register_and_duplicate(self):
        status, headers, body = self.post_json(
            "/api/auth/register", {"username": "alice-1", "password": "alice12345"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["user"]["role"], "user")
        cookie = self.cookie_from(headers)
        status, _, body = self.get("/api/auth/me", cookie=cookie)
        self.assertEqual(json.loads(body)["role"], "user")
        status, _, _ = self.post_json(
            "/api/auth/register", {"username": "alice-1", "password": "alice12345"})
        self.assertEqual(status, 409)

    def test_register_validation(self):
        for username, password in (
                ("ab", "valid12345"),            # 用户名太短
                ("bad name!", "valid12345"),     # 非法字符
                ("valid-name", "short"),         # 密码太短
                ("valid-name", ""),              # 空密码
        ):
            status, _, _ = self.post_json(
                "/api/auth/register", {"username": username, "password": password})
            self.assertEqual(status, 400, (username, password))

    def test_logout_clears_session(self):
        status, headers, _ = self.post_json(
            "/api/auth/login", {"username": "user", "password": "user123456"})
        cookie = self.cookie_from(headers)
        status, _, _ = self.post_json("/api/auth/logout", {}, cookie=cookie)
        self.assertEqual(status, 200)
        status, _, body = self.get("/api/auth/me", cookie=cookie)
        self.assertFalse(json.loads(body)["authenticated"])

    def test_bad_body(self):
        status, _, _ = self.post_json("/api/auth/login", "not-a-dict")
        self.assertEqual(status, 400)
        status, headers, _ = self.raw(
            "POST", "/api/auth/login", body=b"xxxxx",
            headers={"Content-Type": "application/json", "Content-Length": "5"})
        self.assertEqual(status, 400)

    def test_post_to_other_api_still_405(self):
        status, _, body = self.post_json("/api/health", {})
        self.assertEqual(status, 405)
        self.assertEqual(json.loads(body)["error"]["code"], "METHOD_NOT_ALLOWED")

    def test_cookie_parsing_garbage(self):
        status, _, body = self.get("/api/auth/me", cookie="qb_session=garbage")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["authenticated"])


class VersionsApiTests(ApiTestBase):
    def get_json(self, path):
        status, _, body = self.get(path)
        return status, json.loads(body)

    def test_version_list(self):
        status, data = self.get_json("/api/problems/leetcode.com/two-sum/versions")
        self.assertEqual(status, 200)
        self.assertEqual(data["locale"], "en")
        versions = data["versions"]
        self.assertGreaterEqual(len(versions), 3)
        self.assertEqual(sum(1 for v in versions if v["is_current"] == 1), 1)
        sources = {v["source_name"] for v in versions}
        self.assertIn("leetcode-api", sources)
        for v in versions:
            self.assertIn("statement_chars", v)
            self.assertIn("extraction_status", v)

    def test_version_detail(self):
        _, listing = self.get_json("/api/problems/leetcode.com/two-sum/versions")
        other = next(v for v in listing["versions"] if v["is_current"] == 0)
        status, data = self.get_json(
            f"/api/problems/leetcode.com/two-sum/versions?version={other['id']}")
        self.assertEqual(status, 200)
        version = data["version"]
        self.assertEqual(version["id"], other["id"])
        self.assertFalse(version["is_current"])
        self.assertTrue(version["statement_markdown"].strip())
        self.assertIn("revision", version)
        self.assertTrue(all("source_name" in p for p in version["provenance"]))

    def test_current_version_detail(self):
        _, listing = self.get_json("/api/problems/leetcode.com/two-sum/versions")
        current = next(v for v in listing["versions"] if v["is_current"] == 1)
        status, data = self.get_json(
            f"/api/problems/leetcode.com/two-sum/versions?version={current['id']}")
        self.assertEqual(status, 200)
        self.assertTrue(data["version"]["is_current"])

    def test_version_not_found(self):
        status, data = self.get_json(
            "/api/problems/leetcode.com/two-sum/versions?version=999999999")
        self.assertEqual(status, 404)
        self.assertEqual(data["error"]["code"], "NOT_FOUND")

    def test_invalid_version_param(self):
        status, _ = self.get_json(
            "/api/problems/leetcode.com/two-sum/versions?version=abc")
        self.assertEqual(status, 400)
        status, _ = self.get_json(
            "/api/problems/leetcode.com/two-sum/versions?version=-1")
        self.assertEqual(status, 400)

    def test_versions_invalid_site_and_slug(self):
        status, _ = self.get_json("/api/problems/foo.com/two-sum/versions")
        self.assertEqual(status, 400)
        status, _ = self.get_json("/api/problems/leetcode.com/no-such-problem-xyz/versions")
        self.assertEqual(status, 404)

    def test_versions_missing_locale(self):
        status, _ = self.get_json("/api/problems/leetcode.cn/two-sum/versions?locale=en")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()


class StatsApiTests(ApiTestBase):
    def test_stats_contract(self):
        status, _, body = self.get("/api/stats")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["totals"], {
            "problems": 8202, "com": 4101, "cn": 4101, "premium": 789,
            "contents": 15216, "examples": 33847, "issues": 8632,
        })
        self.assertEqual(data["by_difficulty"], {"easy": 1950, "medium": 4278, "hard": 1974})
        self.assertEqual(data["by_category"]["algorithm"], 3683)
        self.assertEqual(data["by_category"]["unknown"], 3683)
        self.assertEqual(data["premium"], {
            "total": 789, "with_statement": 789, "with_examples": 733,
            "example_count": 1552, "with_hints": 0, "with_starter_code": 0,
        })
        self.assertEqual(data["issues_by_type"], {
            "content_conflict": 2950, "difficulty_conflict": 1,
            "identity_field_mismatch": 4103, "paid_statement_absent": 789,
            "statement_missing": 789,
        })
        self.assertRegex(data["generated_at"], r"^\d{4}-\d{2}-\d{2}T")


class IssuesApiTests(ApiTestBase):
    def test_default_list(self):
        status, _, body = self.get("/api/issues")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["total"], 8632)
        self.assertEqual(data["page"], 1)
        self.assertEqual(data["page_size"], 20)
        self.assertEqual(len(data["items"]), 20)
        first = data["items"][0]
        self.assertEqual(first["issue_type"], "paid_statement_absent")
        self.assertIsNone(first["problem"])
        self.assertEqual(set(first), {"id", "issue_type", "severity", "status", "message", "detail", "problem"})

    def test_filter_by_type(self):
        data = json.loads(self.get("/api/issues?type=content_conflict")[2])
        self.assertEqual(data["total"], 2950)
        problem = data["items"][0]["problem"]
        self.assertEqual(problem["site"], "leetcode.com")
        self.assertEqual(problem["slug"], "two-sum")

    def test_filter_by_severity(self):
        data = json.loads(self.get("/api/issues?severity=warning")[2])
        self.assertEqual(data["total"], 7054)

    def test_filter_by_status(self):
        data = json.loads(self.get("/api/issues?status=resolved")[2])
        self.assertEqual(data["total"], 0)
        self.assertEqual(data["items"], [])

    def test_pagination(self):
        data = json.loads(self.get("/api/issues?page=2")[2])
        self.assertEqual(data["items"][0]["id"], 21)

    def test_page_size_clamp(self):
        data = json.loads(self.get("/api/issues?page_size=500")[2])
        self.assertEqual(data["page_size"], 100)

    def test_invalid_type(self):
        status, _, _ = self.get("/api/issues?type=nope")
        self.assertEqual(status, 400)

    def test_invalid_page(self):
        status, _, _ = self.get("/api/issues?page=0")
        self.assertEqual(status, 400)


class RandomDailyApiTests(ApiTestBase):
    def test_random_shape(self):
        status, _, body = self.get("/api/random")
        self.assertEqual(status, 200)
        item = json.loads(body)["random"]
        self.assertEqual(set(item), {"site", "slug", "display_id", "title", "locale", "difficulty", "is_paid_only"})
        self.assertIn(item["site"], ("leetcode.com", "leetcode.cn"))

    def test_random_site_filter(self):
        item = json.loads(self.get("/api/random?site=leetcode.com")[2])["random"]
        self.assertEqual(item["site"], "leetcode.com")

    def test_random_difficulty_filter(self):
        item = json.loads(self.get("/api/random?difficulty=easy")[2])["random"]
        self.assertEqual(item["difficulty"], "easy")

    def test_random_invalid_difficulty(self):
        status, _, _ = self.get("/api/random?difficulty=impossible")
        self.assertEqual(status, 400)

    def test_daily_deterministic(self):
        first = json.loads(self.get("/api/daily")[2])
        second = json.loads(self.get("/api/daily")[2])
        self.assertEqual(first, second)
        self.assertRegex(first["date"], r"^\d{8}$")
        self.assertEqual(first["total"], 8202)
        self.assertEqual(set(first["daily"]), {"site", "slug", "display_id", "title", "locale", "difficulty", "is_paid_only"})

    def test_daily_offset_matches_db(self):
        import sqlite3
        from datetime import datetime, timezone
        data = json.loads(self.get("/api/daily")[2])
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        conn = sqlite3.connect(f"file:{DB_DEFAULT}?mode=ro", uri=True)
        row = conn.execute(
            "SELECT i.site, i.slug FROM problem_source_identity i "
            "JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1 "
            "ORDER BY c.id LIMIT 1 OFFSET ?", (int(today) % data["total"],)).fetchone()
        conn.close()
        self.assertEqual((data["daily"]["site"], data["daily"]["slug"]), row)


class PremiumApiTests(ApiTestBase):
    def test_summary_contract(self):
        status, _, body = self.get("/api/premium/summary")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["site"], "leetcode.com")
        self.assertEqual(data["total"], 789)
        self.assertEqual(data["with_statement"], 789)
        self.assertEqual(data["with_examples"], 733)
        self.assertEqual(data["example_count"], 1552)
        self.assertEqual(data["with_hints"], 0)
        self.assertEqual(data["with_starter_code"], 0)
        self.assertEqual(data["free_total"], 3312)
        self.assertEqual(data["unknown_total"], 4101)
        self.assertEqual(data["by_difficulty"], {"easy": 129, "medium": 465, "hard": 195})
        self.assertEqual(data["by_category"], {
            "algorithm": 538, "database": 218, "javascript": 30, "concurrency": 3,
        })
        self.assertEqual(data["top_tags"][:3], [
            {"code": "array", "count": 326},
            {"code": "database", "count": 218},
            {"code": "hash-table", "count": 128},
        ])
        self.assertIn("doocs", data["source_note"])
        self.assertRegex(data["generated_at"], r"^\d{4}-\d{2}-\d{2}T")

    def test_paid_unknown(self):
        data = json.loads(self.get("/api/problems?paid=unknown")[2])
        self.assertEqual(data["total"], 4101)
        self.assertTrue(all(item["is_paid_only"] is None for item in data["items"]))

    def test_paid_free(self):
        data = json.loads(self.get("/api/problems?paid=0")[2])
        self.assertEqual(data["total"], 3312)
        self.assertTrue(all(item["is_paid_only"] == 0 for item in data["items"]))

    def test_tag_filter(self):
        data = json.loads(self.get("/api/problems?paid=1&tag=database")[2])
        self.assertEqual(data["total"], 218)
        self.assertTrue(all("database" in item["tags"] for item in data["items"]))

    def test_has_examples_flag(self):
        data = json.loads(self.get("/api/problems?paid=1&has_examples=1")[2])
        self.assertEqual(data["total"], 733)
        self.assertTrue(all(item["has_examples"] for item in data["items"]))
        data2 = json.loads(self.get("/api/problems?paid=1")[2])
        flagged = sum(1 for item in data2["items"] if item["has_examples"])
        self.assertLess(flagged, len(data2["items"]))  # some rows lack examples

    def test_invalid_tag(self):
        status, _, _ = self.get("/api/problems?tag=%20")
        self.assertEqual(status, 400)

    def test_random_paid(self):
        item = json.loads(self.get("/api/random?paid=1")[2])["random"]
        self.assertEqual(item["is_paid_only"], 1)
        self.assertEqual(item["site"], "leetcode.com")
        free = json.loads(self.get("/api/random?paid=0")[2])["random"]
        self.assertEqual(free["is_paid_only"], 0)

    def test_random_invalid_paid(self):
        status, _, _ = self.get("/api/random?paid=bogus")
        self.assertEqual(status, 400)


class StudyLogicTests(unittest.TestCase):
    def test_study_module_node_tests(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node not available")
        result = subprocess.run(
            [node, str(ROOT / "tests" / "test_study.mjs")],
            cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_runner_module_node_tests(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node not available")
        result = subprocess.run(
            [node, str(ROOT / "tests" / "test_runner.mjs")],
            cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
