"""SQLite 연결과 테이블 생성."""

import os
import sqlite3
from pathlib import Path

from app.categories import DEFAULT_CATEGORIES

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

CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    name        TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 20),
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    UNIQUE (type, name)
);

-- v0.10 분류별 월 예산 (지출 분류만, 모든 달 공통)
CREATE TABLE IF NOT EXISTS budgets (
    category_id INTEGER PRIMARY KEY,
    amount      INTEGER NOT NULL CHECK (amount >= 1)
);

-- v0.11 고정 거래 틀과 불러온 기록
CREATE TABLE IF NOT EXISTS recurring_transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day         INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount      INTEGER NOT NULL CHECK (amount >= 1),
    category_id INTEGER NOT NULL,
    memo        TEXT,
    created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_applied (
    recurring_id INTEGER NOT NULL,
    year_month   TEXT    NOT NULL,
    PRIMARY KEY (recurring_id, year_month)
);
"""


def get_db_path():
    """테스트에서는 BUDGET_DB_PATH로 임시 DB 파일을 지정한다."""
    return os.environ.get("BUDGET_DB_PATH", str(DEFAULT_DB_PATH))


def connect():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """테이블을 만들고 기본 분류를 넣는다. MVP 시절 DB에서도 그대로 동작한다."""
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        with conn:
            conn.executemany(
                "INSERT OR IGNORE INTO categories (type, name, is_default) VALUES (?, ?, 1)",
                [(type_, name) for type_, names in DEFAULT_CATEGORIES.items() for name in names],
            )
    finally:
        conn.close()


def find_category_by_id(category_id):
    conn = connect()
    try:
        return conn.execute("SELECT id, type, name FROM categories WHERE id = ?", (category_id,)).fetchone()
    finally:
        conn.close()


def category_exists(type_, name):
    conn = connect()
    try:
        row = conn.execute(
            "SELECT 1 FROM categories WHERE type = ? AND name = ?", (type_, name)
        ).fetchone()
        return row is not None
    finally:
        conn.close()
