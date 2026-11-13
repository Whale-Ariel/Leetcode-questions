"""Local account system: separate users database, never touches the question bank.

- 密码使用 PBKDF2-HMAC-SHA256（每用户随机盐，20 万次迭代）
- 会话令牌只以 SHA-256 摘要形式落库，Cookie 为 HttpOnly + SameSite=Strict
- 角色只控制界面与附加功能入口，不影响题目内容的可读性
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_DIR = Path(__file__).resolve().parents[2] / "db"
AUTH_DB = DB_DIR / "users.sqlite"
SESSION_COOKIE = "qb_session"
SESSION_TTL = timedelta(days=7)
PBKDF2_ITERATIONS = 200_000

ROLES = {"guest", "user", "premium"}
ROLE_LABELS = {"guest": "游客", "user": "普通用户", "premium": "高级用户"}
USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")
PASSWORD_MIN, PASSWORD_MAX = 8, 128

SEED_ACCOUNTS = [
    {"username": "guest", "password": "guest123456", "role": "guest"},
    {"username": "user", "password": "user123456", "role": "user"},
    {"username": "premium", "password": "premium123456", "role": "premium"},
]


class AuthError(ValueError):
    """带用户可读信息的认证错误（映射为 HTTP 400/401/409）。"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def connect_auth(db_path: Path = AUTH_DB) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            role TEXT NOT NULL CHECK (role IN ('guest','user','premium')),
            salt_hex TEXT NOT NULL,
            hash_hex TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )"""
    )
    return conn


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return hmac.compare_digest(digest, expected)


def _validate_credentials(username: str, password: str) -> None:
    if not isinstance(username, str) or not USERNAME_RE.fullmatch(username):
        raise AuthError("用户名须为 3-32 位字母、数字、下划线或连字符")
    if not isinstance(password, str) or not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        raise AuthError(f"密码长度须在 {PASSWORD_MIN}-{PASSWORD_MAX} 位之间")


def create_user(conn: sqlite3.Connection, username: str, password: str,
                role: str = "user") -> dict:
    _validate_credentials(username, password)
    if role not in ROLES:
        raise AuthError("角色不合法")
    exists = conn.execute(
        "SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
    if exists:
        raise AuthError("用户名已存在")
    salt_hex, hash_hex = hash_password(password)
    conn.execute(
        "INSERT INTO users (username, role, salt_hex, hash_hex, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (username, role, salt_hex, hash_hex, _now().isoformat()))
    conn.commit()
    return {"username": username, "role": role}


def authenticate(conn: sqlite3.Connection, username: str, password: str) -> dict:
    row = conn.execute(
        "SELECT role, salt_hex, hash_hex FROM users WHERE username = ?",
        (username,)).fetchone()
    if row is None or not verify_password(password, row["salt_hex"], row["hash_hex"]):
        raise AuthError("用户名或密码不正确")
    return {"username": username, "role": row["role"]}


def create_session(conn: sqlite3.Connection, username: str) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    now = _now()
    expires = now + SESSION_TTL
    conn.execute(
        "INSERT INTO sessions (token_hash, username, created_at, expires_at) "
        "VALUES (?, ?, ?, ?)",
        (hashlib.sha256(token.encode()).hexdigest(), username,
         now.isoformat(), expires.isoformat()))
    conn.commit()
    return token, expires


def resolve_session(conn: sqlite3.Connection, token: str) -> dict | None:
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = conn.execute(
        "SELECT u.username, u.role, s.expires_at FROM sessions s "
        "JOIN users u ON u.username = s.username "
        "WHERE s.token_hash = ?", (token_hash,)).fetchone()
    if row is None:
        return None
    try:
        expires = datetime.fromisoformat(row["expires_at"])
    except ValueError:
        return None
    if expires <= _now():
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        conn.commit()
        return None
    return {"username": row["username"], "role": row["role"]}


def drop_session(conn: sqlite3.Connection, token: str) -> None:
    if not token:
        return
    conn.execute("DELETE FROM sessions WHERE token_hash = ?",
                 (hashlib.sha256(token.encode()).hexdigest(),))
    conn.commit()


def ensure_seed_users(conn: sqlite3.Connection) -> list[str]:
    """Create the built-in test accounts if missing; returns created usernames."""
    created = []
    for account in SEED_ACCOUNTS:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username = ?", (account["username"],)).fetchone()
        if exists:
            continue
        salt_hex, hash_hex = hash_password(account["password"])
        conn.execute(
            "INSERT INTO users (username, role, salt_hex, hash_hex, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (account["username"], account["role"], salt_hex, hash_hex,
             _now().isoformat()))
        created.append(account["username"])
    conn.commit()
    return created


def seed_if_missing(db_path: Path = AUTH_DB) -> list[str]:
    conn = connect_auth(db_path)
    try:
        return ensure_seed_users(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    created = seed_if_missing()
    print("seeded:", created or "(accounts already present)", file=sys.stderr)
