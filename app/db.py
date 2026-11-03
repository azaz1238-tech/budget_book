"""SQLite 연결과 테이블 생성."""

import os
import sqlite3
from pathlib import Path

from app.categories import DEFAULT_CATEGORIES, TYPE_LABELS

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "budget.db"

TRANSACTIONS_COLUMNS = """
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount      INTEGER NOT NULL CHECK (amount >= 1),
    category_id INTEGER NOT NULL,
    memo        TEXT,
    created_at  TEXT    NOT NULL
"""

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS transactions ({TRANSACTIONS_COLUMNS});

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


def connect(path=None):
    conn = sqlite3.connect(path or get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def table_columns(conn, table):
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def save_copy(conn, filename):
    """지금 DB의 사본을 DB 파일 옆에 남기고 파일 이름을 돌려준다. 이미 있는 사본은 덮어쓰지 않는다."""
    first = Path(get_db_path()).parent / filename
    target, number = first, 0
    while target.exists():
        number += 1
        target = first.with_name(f"{first.stem}-{number}{first.suffix}")
    copy = sqlite3.connect(target)
    try:
        conn.backup(copy)
    finally:
        copy.close()
    return target.name


class InvalidCategoryNameError(sqlite3.IntegrityError):
    """이전 구조 DB의 분류 이름이 규칙에 맞지 않아 옮길 수 없다. 복원에서는 INVALID_BACKUP이 된다."""


def check_legacy_category_names(conn):
    """옮기다 CHECK 제약에 걸리기 전에 문제가 된 이름을 모두 찾아 알려 준다 (TRD 15.1절)."""
    rows = conn.execute(
        "SELECT DISTINCT type, category FROM transactions "
        "WHERE length(trim(category)) NOT BETWEEN 1 AND 20 ORDER BY type, category"
    ).fetchall()
    if rows:
        names = ", ".join(f"{TYPE_LABELS[row[0]]} '{row[1]}'" for row in rows)
        raise InvalidCategoryNameError(
            f"이전 구조 DB를 옮길 수 없습니다. 분류 이름은 1~20자여야 합니다: {names}. "
            "DB는 바꾸지 않았습니다. 이 이름을 고친 뒤 다시 시도하세요."
        )


def migrate_transactions(conn):
    """v1.0: 거래의 분류를 이름에서 분류 ID로 옮긴다 (TRD 15.1절). 실패하면 모두 롤백된다."""
    sequence = conn.execute("SELECT seq FROM sqlite_sequence WHERE name = 'transactions'").fetchone()
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        # 분류 목록에 없는 이름의 거래가 조회에서 사라지지 않도록 사용자 분류로 추가한다.
        # OR IGNORE는 CHECK 위반도 건너뛰어 거래가 사라지므로 쓰지 않는다. 위반하면 오류로 멈춘다.
        conn.execute(
            "INSERT INTO categories (type, name, is_default) "
            "SELECT DISTINCT t.type, t.category, 0 FROM transactions t "
            "WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.type = t.type AND c.name = t.category)"
        )
        conn.execute(f"CREATE TABLE transactions_new ({TRANSACTIONS_COLUMNS})")
        conn.execute(
            "INSERT INTO transactions_new (id, date, type, amount, category_id, memo, created_at) "
            "SELECT t.id, t.date, t.type, t.amount, c.id, t.memo, t.created_at "
            "FROM transactions t JOIN categories c ON c.type = t.type AND c.name = t.category"
        )
        conn.execute("DROP TABLE transactions")
        conn.execute("ALTER TABLE transactions_new RENAME TO transactions")
        conn.execute("CREATE INDEX idx_transactions_date ON transactions (date)")
        # 지워진 거래의 ID를 다시 쓰지 않도록 AUTOINCREMENT 값을 이어받는다.
        if sequence is not None:
            conn.execute("DELETE FROM sqlite_sequence WHERE name = 'transactions'")
            conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('transactions', ?)", (sequence[0],))


def init_db(path=None, keep_safety_copy=True):
    """테이블을 만들고 기본 분류를 넣는다. 이전 버전 DB는 현재 구조로 옮긴다."""
    conn = connect(path)
    try:
        needs_migration = "category" in table_columns(conn, "transactions")
        if needs_migration:
            check_legacy_category_names(conn)
        if needs_migration and keep_safety_copy:
            save_copy(conn, "budget-before-v1.0.db")
        conn.executescript(SCHEMA)
        with conn:
            conn.executemany(
                "INSERT OR IGNORE INTO categories (type, name, is_default) VALUES (?, ?, 1)",
                [(type_, name) for type_, names in DEFAULT_CATEGORIES.items() for name in names],
            )
        if needs_migration:
            migrate_transactions(conn)
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
