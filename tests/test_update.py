"""Unit tests for the update pipeline helpers (no network)."""

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from qb.update import _remove_db, swap_db  # noqa: E402


class SwapDbTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_swap_replaces_final_and_writes_backup(self):
        final = self.base / "question-bank.sqlite"
        final.write_bytes(b"old")
        backup_dir = self.base / "backups"
        tmp = Path(str(final) + ".update-tmp")
        tmp.write_bytes(b"new")
        backup = swap_db(tmp, final, backup_dir=backup_dir)
        self.assertIsNotNone(backup)
        self.assertTrue(backup.exists())
        self.assertEqual(backup.read_bytes(), b"old")
        self.assertEqual(final.read_bytes(), b"new")
        self.assertFalse(tmp.exists())
        self.assertTrue(backup.is_relative_to(backup_dir))

    def test_swap_without_previous_db(self):
        final = self.base / "fresh.sqlite"
        tmp = self.base / "fresh.sqlite.update-tmp"
        tmp.write_bytes(b"new")
        backup = swap_db(tmp, final, backup_dir=self.base / "backups")
        self.assertIsNone(backup)
        self.assertEqual(final.read_bytes(), b"new")

    def test_swap_removes_stale_wal_files(self):
        final = self.base / "stale.sqlite"
        final.write_bytes(b"old")
        Path(str(final) + "-wal").write_bytes(b"stale-wal")
        Path(str(final) + "-shm").write_bytes(b"stale-shm")
        tmp = self.base / "stale.sqlite.update-tmp"
        tmp.write_bytes(b"new")
        swap_db(tmp, final, backup_dir=self.base / "backups")
        self.assertEqual(final.read_bytes(), b"new")
        self.assertFalse(Path(str(final) + "-wal").exists())
        self.assertFalse(Path(str(final) + "-shm").exists())

    def test_remove_db_cleans_sidecars(self):
        db = self.base / "x.sqlite"
        db.write_bytes(b"x")
        Path(str(db) + "-wal").write_bytes(b"w")
        Path(str(db) + "-shm").write_bytes(b"s")
        _remove_db(db)
        self.assertFalse(db.exists())
        self.assertFalse(Path(str(db) + "-wal").exists())
        self.assertFalse(Path(str(db) + "-shm").exists())


if __name__ == "__main__":
    unittest.main()
