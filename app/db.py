"""SQLite 연결과 테이블 생성."""

import os
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "budget.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount      INTEGER NOT NULL CHECK (amount >= 1),
    category    TEXT    NOT NULL,
    memo        TEXT,
    created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
"""


def get_db_path():
    """테스트에서는 BUDGET_DB_PATH로 임시 DB 파일을 지정한다."""
    return os.environ.get("BUDGET_DB_PATH", str(DEFAULT_DB_PATH))


def connect():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = connect()
    try:
        conn.executescript(SCHEMA)
    finally:
        conn.close()
