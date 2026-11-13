"""Unit tests for the account module (separate users database)."""

import sys
import tempfile
import unittest
from datetime import timedelta, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from qb.auth import (  # noqa: E402
    AuthError,
    authenticate,
    connect_auth,
    create_session,
    create_user,
    drop_session,
    ensure_seed_users,
    hash_password,
    resolve_session,
    verify_password,
)


class AuthUnitTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self._tmp.name) / "users.sqlite"
        self.conn = connect_auth(self.db_path)

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def test_password_hash_roundtrip(self):
        salt_hex, hash_hex = hash_password("s3cret-pass")
        self.assertNotEqual(salt_hex, hash_hex)
        self.assertTrue(verify_password("s3cret-pass", salt_hex, hash_hex))
        self.assertFalse(verify_password("wrong-pass", salt_hex, hash_hex))
        # 相同密码每次得到不同盐与摘要
        salt2, hash2 = hash_password("s3cret-pass")
        self.assertNotEqual(salt_hex, salt2)
        self.assertNotEqual(hash_hex, hash2)

    def test_verify_rejects_malformed_hex(self):
        self.assertFalse(verify_password("x", "zz", "yy"))

    def test_create_user_and_duplicate(self):
        user = create_user(self.conn, "alice-2", "alice12345")
        self.assertEqual(user["role"], "user")
        with self.assertRaises(AuthError):
            create_user(self.conn, "alice-2", "alice12345")
        with self.assertRaises(AuthError):
            create_user(self.conn, "bad role", "alice12345", role="admin")
        with self.assertRaises(AuthError):
            create_user(self.conn, "bad name!", "alice12345")
        with self.assertRaises(AuthError):
            create_user(self.conn, "valid-name", "short")

    def test_authenticate(self):
        create_user(self.conn, "bob-1", "bob123456")
        self.assertEqual(authenticate(self.conn, "bob-1", "bob123456")["role"], "user")
        with self.assertRaises(AuthError):
            authenticate(self.conn, "bob-1", "wrong-pass")
        with self.assertRaises(AuthError):
            authenticate(self.conn, "nobody", "bob123456")

    def test_session_lifecycle(self):
        create_user(self.conn, "carol-1", "carol12345")
        token, expires = create_session(self.conn, "carol-1")
        self.assertTrue(expires > datetime.now(timezone.utc))
        session = resolve_session(self.conn, token)
        self.assertEqual(session["username"], "carol-1")
        self.assertEqual(session["role"], "user")
        self.assertIsNone(resolve_session(self.conn, "garbage-token"))
        drop_session(self.conn, token)
        self.assertIsNone(resolve_session(self.conn, token))
        drop_session(self.conn, "")  # 空令牌安全

    def test_expired_session_rejected(self):
        create_user(self.conn, "dave-1", "dave12345")
        token, _ = create_session(self.conn, "dave-1")
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        self.conn.execute(
            "UPDATE sessions SET expires_at = ? "
            "WHERE username = 'dave-1'", (past,))
        self.conn.commit()
        self.assertIsNone(resolve_session(self.conn, token))

    def test_seed_users_idempotent_and_roles(self):
        created1 = ensure_seed_users(self.conn)
        self.assertEqual(set(created1), {"guest", "user", "premium"})
        created2 = ensure_seed_users(self.conn)
        self.assertEqual(created2, [])
        for username, role in (("guest", "guest"), ("user", "user"), ("premium", "premium")):
            row = self.conn.execute(
                "SELECT role FROM users WHERE username = ?", (username,)).fetchone()
            self.assertEqual(row["role"], role)
        self.assertEqual(
            authenticate(self.conn, "premium", "premium123456")["role"], "premium")


if __name__ == "__main__":
    unittest.main()
