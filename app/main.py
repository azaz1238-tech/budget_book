import calendar
import logging
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Query, Request
from fastapi import Path as PathParam
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.categories import TYPE_LABELS
from app.db import connect, init_db
from app.schemas import (
    BudgetInput,
    CategoryInput,
    CategoryRename,
    RecurringApplyInput,
    RecurringInput,
    TransactionInput,
)

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# 입력값 검사 순서 (API_SPEC 1.2절). 에러가 여러 개면 이 순서로 첫 번째만 돌려준다.
# 거래: date → type → amount → category → memo, 분류: type → name,
# 고정 거래: day → type → amount → category_id → memo
FIELD_ORDER = ["date", "day", "type", "amount", "category", "category_id", "name", "memo"]
REQUIRED_FIELDS = {"date", "day", "type", "amount", "category", "category_id", "name"}

FIELD_ERROR_CODES = {
    "date": "INVALID_DATE",
    "day": "INVALID_DAY",
    "type": "INVALID_TYPE",
    "amount": "INVALID_AMOUNT",
    "category": "INVALID_CATEGORY",
    "category_id": "INVALID_CATEGORY",
    "name": "INVALID_CATEGORY_NAME",
    "memo": "INVALID_MEMO",
}

MISSING_MESSAGES = {
    "date": "거래일을 입력해 주세요.",
    "day": "날을 입력해 주세요.",
    "type": "거래 유형을 선택해 주세요.",
    "amount": "금액을 입력해 주세요.",
    "category": "분류를 선택해 주세요.",
    "category_id": "분류를 선택해 주세요.",
    "name": "분류 이름을 입력해 주세요.",
}

# 경로의 id 형식이 틀렸을 때 경로별 문구
INVALID_ID_MESSAGES = {
    "/api/categories/": "분류 ID가 올바르지 않습니다.",
    "/api/budgets/": "분류 ID가 올바르지 않습니다.",
    "/api/recurring/": "고정 거래 ID가 올바르지 않습니다.",
}

MAX_KEYWORD_LENGTH = 50

MESSAGES = {
    "INVALID_JSON": "요청 형식이 올바르지 않습니다.",
    "INVALID_DATE": "거래일이 올바른 날짜가 아닙니다.",
    "INVALID_TYPE": "거래 유형은 수입 또는 지출이어야 합니다.",
    "INVALID_AMOUNT": "금액은 1 이상의 정수여야 합니다.",
    "INVALID_CATEGORY": "분류가 올바르지 않습니다.",
    "INVALID_MEMO": "메모는 문자열이어야 합니다.",
    "INVALID_ID": "거래 ID가 올바르지 않습니다.",
    "TRANSACTION_NOT_FOUND": "이미 삭제되었거나 없는 내역입니다.",
    "INVALID_CATEGORY_NAME": "분류 이름은 문자열이어야 합니다.",
    "CATEGORY_NOT_FOUND": "이미 삭제되었거나 없는 분류입니다.",
    "DEFAULT_CATEGORY_LOCKED": "기본 분류는 수정하거나 삭제할 수 없습니다.",
    "INVALID_BUDGET_CATEGORY": "수입 분류에는 예산을 정할 수 없습니다.",
    "BUDGET_NOT_FOUND": "예산이 정해지지 않은 분류입니다.",
    "INVALID_DAY": "날은 1부터 31 사이여야 합니다.",
    "RECURRING_NOT_FOUND": "이미 삭제되었거나 없는 고정 거래입니다.",
    "NOT_FOUND": "요청한 주소를 찾을 수 없습니다.",
    "METHOD_NOT_ALLOWED": "지원하지 않는 요청 방식입니다.",
    "DATABASE_ERROR": "데이터베이스 작업에 실패했습니다.",
    "INTERNAL_ERROR": "서버에서 오류가 발생했습니다.",
}


class ApiError(Exception):
    """엔드포인트에서 정해진 에러 코드로 응답할 때 사용한다."""

    def __init__(self, status_code, code, message=None):
        self.status_code = status_code
        self.code = code
        self.message = message or MESSAGES[code]


def error_response(status_code, code, message=None):
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message or MESSAGES[code]}},
    )


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(title="가계부", lifespan=lifespan)


@app.exception_handler(ApiError)
async def handle_api_error(request: Request, exc: ApiError):
    return error_response(exc.status_code, exc.code, exc.message)


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 405:
        return error_response(405, "METHOD_NOT_ALLOWED")
    if exc.status_code == 404:
        return error_response(404, "NOT_FOUND")
    logger.error("Unhandled HTTP error %s: %s", exc.status_code, exc.detail)
    return error_response(500, "INTERNAL_ERROR")


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    status_code, code, message = classify_validation_errors(exc.errors(), request.url.path)
    return error_response(status_code, code, message)


@app.exception_handler(sqlite3.Error)
async def handle_database_error(request: Request, exc: sqlite3.Error):
    logger.exception("Database error on %s %s", request.method, request.url.path)
    return error_response(500, "DATABASE_ERROR")


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception):
    logger.exception("Unexpected error on %s %s", request.method, request.url.path)
    return error_response(500, "INTERNAL_ERROR")


def classify_validation_errors(errors, url_path):
    """FastAPI 검증 에러 목록을 (상태 코드, code, message) 하나로 바꾼다."""
    path_errors = [e for e in errors if e["loc"][0] == "path"]
    if path_errors:
        for prefix, message in INVALID_ID_MESSAGES.items():
            if url_path.startswith(prefix):
                return 422, "INVALID_ID", message
        return 422, "INVALID_ID", None

    query_errors = [e for e in errors if e["loc"][0] == "query"]
    if query_errors:
        return year_month_error(query_errors)

    # 본문이 깨진 JSON이거나 JSON 객체가 아닌 경우
    if any(e["type"] == "json_invalid" or tuple(e["loc"]) == ("body",) for e in errors):
        return 400, "INVALID_JSON", None

    # 고정 거래 불러오기 본문의 year·month는 조회 쿼리와 같은 규칙으로 안내한다.
    month_errors = [e for e in errors if len(e["loc"]) >= 2 and e["loc"][1] in ("year", "month")]
    if month_errors:
        return year_month_error(month_errors)

    field_errors = [e for e in errors if len(e["loc"]) >= 2 and e["loc"][1] in FIELD_ORDER]
    if not field_errors:
        return 400, "INVALID_JSON", None

    first = min(field_errors, key=lambda e: FIELD_ORDER.index(e["loc"][1]))
    field = first["loc"][1]
    if field in REQUIRED_FIELDS and (first["type"] == "missing" or first.get("input") is None):
        return 422, "MISSING_FIELD", MISSING_MESSAGES[field]

    message = None
    if first["type"] == "value_error":
        # 검증기에서 ValueError로 직접 지정한 문구
        message = str(first.get("ctx", {}).get("error", "")) or None
    return 422, FIELD_ERROR_CODES[field], message


def year_month_error(errors):
    """연·월(그리고 분류 필터 유형) 오류를 INVALID_QUERY 하나로 바꾼다."""
    names = {e["loc"][-1] for e in errors}
    if any(e["type"] == "missing" for e in errors):
        return 422, "INVALID_QUERY", "조회할 연도와 월을 입력해 주세요."
    if "month" in names:
        return 422, "INVALID_QUERY", "월은 1부터 12 사이여야 합니다."
    if "year" in names:
        return 422, "INVALID_QUERY", "연도는 1부터 9999 사이여야 합니다."
    return 422, "INVALID_QUERY", "분류 필터의 유형이 올바르지 않습니다."


@contextmanager
def open_db(failure_message):
    """DB 연결을 열고, sqlite 오류는 내부 정보를 숨긴 DATABASE_ERROR로 바꾼다."""
    conn = None
    try:
        conn = connect()
        yield conn
    except sqlite3.Error as exc:
        logger.exception("Database error: %s", failure_message)
        raise ApiError(500, "DATABASE_ERROR", failure_message) from exc
    finally:
        if conn is not None:
            conn.close()


TRANSACTION_COLUMNS = "id, date, type, amount, category, memo, created_at"

# SQLite INTEGER의 최대값. 이보다 큰 id는 DB에 넘기지 않고 INVALID_ID로 처리한다.
MAX_ID = 2**63 - 1


def month_bounds(year, month):
    last_day = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


def month_conditions(year, month, type_=None, category=None, q=None):
    """월 범위 조건에 유형·분류·메모 검색어 조건(있는 것만)을 더한다."""
    first_day, last_day = month_bounds(year, month)
    where, params = ["date BETWEEN ? AND ?"], [first_day, last_day]
    # 같은 이름이 지출·수입에 모두 있을 수 있어 분류는 유형과 함께 받아야 정해진다.
    if category is not None and (type_ is None or not category):
        raise ApiError(422, "INVALID_QUERY", "분류 필터는 유형과 분류를 함께 지정해야 합니다.")
    if type_ is not None:
        where.append("type = ?")
        params.append(type_)
    if category is not None:
        where.append("category = ?")
        params.append(category)
    keyword = (q or "").strip()
    if len(keyword) > MAX_KEYWORD_LENGTH:
        raise ApiError(422, "INVALID_QUERY", f"검색어는 {MAX_KEYWORD_LENGTH}자 이하여야 합니다.")
    if keyword:
        # %, _ 를 와일드카드가 아닌 일반 글자로 찾는다. SQLite LIKE는 영문 대소문자를 구분하지 않는다.
        escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where.append("memo LIKE ? ESCAPE '\\'")
        params.append(f"%{escaped}%")
    return " AND ".join(where), params


FilterType = Literal["income", "expense"] | None


CATEGORY_COLUMNS = "id, type, name, is_default"


def category_to_dict(row):
    return {"id": row["id"], "type": row["type"], "name": row["name"], "is_default": bool(row["is_default"])}


def fetch_category(conn, category_id):
    return conn.execute(f"SELECT {CATEGORY_COLUMNS} FROM categories WHERE id = ?", (category_id,)).fetchone()


def get_user_category(conn, category_id):
    """수정·삭제할 사용자 분류를 찾는다. 없으면 404, 기본 분류면 409."""
    row = fetch_category(conn, category_id)
    if row is None:
        raise ApiError(404, "CATEGORY_NOT_FOUND")
    if row["is_default"]:
        raise ApiError(409, "DEFAULT_CATEGORY_LOCKED")
    return row


def ensure_category_name_available(conn, type_, name, exclude_id=None):
    row = conn.execute(
        "SELECT 1 FROM categories WHERE type = ? AND name = ? AND id IS NOT ?", (type_, name, exclude_id)
    ).fetchone()
    if row is not None:
        raise ApiError(409, "DUPLICATE_CATEGORY", f"{TYPE_LABELS[type_]}에 이미 '{name}' 분류가 있습니다.")


@app.get("/api/categories")
def list_categories():
    with open_db("분류 목록을 불러오지 못했습니다.") as conn:
        rows = conn.execute(
            f"SELECT {CATEGORY_COLUMNS} FROM categories ORDER BY is_default DESC, id"
        ).fetchall()
    result = {"expense": [], "income": []}
    for row in rows:
        result[row["type"]].append(category_to_dict(row))
    return result


@app.post("/api/categories", status_code=201)
def create_category(body: CategoryInput):
    with open_db("분류를 저장하지 못했습니다.") as conn:
        with conn:
            ensure_category_name_available(conn, body.type, body.name)
            cursor = conn.execute("INSERT INTO categories (type, name) VALUES (?, ?)", (body.type, body.name))
        row = fetch_category(conn, cursor.lastrowid)
    return category_to_dict(row)


@app.put("/api/categories/{category_id}")
def rename_category(body: CategoryRename, category_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("분류를 수정하지 못했습니다.") as conn:
        with conn:
            category = get_user_category(conn, category_id)
            if body.name != category["name"]:
                ensure_category_name_available(conn, category["type"], body.name, exclude_id=category_id)
                # 분류 이름과 그 분류를 쓰는 거래의 분류를 한 트랜잭션에서 함께 바꾼다.
                conn.execute("UPDATE categories SET name = ? WHERE id = ?", (body.name, category_id))
                conn.execute(
                    "UPDATE transactions SET category = ? WHERE type = ? AND category = ?",
                    (body.name, category["type"], category["name"]),
                )
        row = fetch_category(conn, category_id)
    return category_to_dict(row)


@app.delete("/api/categories/{category_id}", status_code=204)
def delete_category(category_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("분류를 삭제하지 못했습니다.") as conn:
        with conn:
            category = get_user_category(conn, category_id)
            used = conn.execute(
                "SELECT COUNT(*) FROM transactions WHERE type = ? AND category = ?",
                (category["type"], category["name"]),
            ).fetchone()[0]
            recurring = conn.execute(
                "SELECT COUNT(*) FROM recurring_transactions WHERE category_id = ?", (category_id,)
            ).fetchone()[0]
            if recurring:
                parts = ([f"거래 {used}건"] if used else []) + [f"고정 거래 {recurring}건"]
                raise ApiError(409, "CATEGORY_IN_USE", f"이 분류를 사용하는 {', '.join(parts)}이 있어 삭제할 수 없습니다.")
            if used:
                raise ApiError(409, "CATEGORY_IN_USE", f"이 분류를 사용하는 거래가 {used}건 있어 삭제할 수 없습니다.")
            conn.execute("DELETE FROM budgets WHERE category_id = ?", (category_id,))
            conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    return Response(status_code=204)


@app.get("/api/transactions")
def list_transactions(
    year: int = Query(ge=1, le=9999),
    month: int = Query(ge=1, le=12),
    type_: FilterType = Query(None, alias="type"),
    category: str | None = Query(None),
    q: str | None = Query(None),
):
    where, params = month_conditions(year, month, type_, category, q)
    with open_db("거래 내역을 불러오지 못했습니다.") as conn:
        rows = conn.execute(
            f"SELECT {TRANSACTION_COLUMNS} FROM transactions WHERE {where} "
            "ORDER BY date DESC, created_at DESC, id DESC",
            params,
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/summary/categories")
def get_category_spending(year: int = Query(ge=1, le=9999), month: int = Query(ge=1, le=12)):
    where, params = month_conditions(year, month, "expense")
    with open_db("분류별 지출을 불러오지 못했습니다.") as conn:
        rows = conn.execute(
            f"SELECT category, SUM(amount) AS amount, COUNT(*) AS count FROM transactions WHERE {where} "
            "GROUP BY category",
            params,
        ).fetchall()
        budgets = conn.execute(
            "SELECT c.name, b.amount FROM budgets b JOIN categories c ON c.id = b.category_id "
            "WHERE c.type = 'expense'"
        ).fetchall()
    items = {row["category"]: {"category": row["category"], "amount": row["amount"], "count": row["count"]} for row in rows}
    budget_by_name = {row["name"]: row["amount"] for row in budgets}
    # 예산이 있는 분류는 그 달 지출이 없어도 사용률을 보여 주기 위해 넣는다.
    for name in budget_by_name:
        items.setdefault(name, {"category": name, "amount": 0, "count": 0})
    for item in items.values():
        budget = budget_by_name.get(item["category"])
        item["budget"] = budget
        item["remaining"] = None if budget is None else budget - item["amount"]
    ordered = sorted(items.values(), key=lambda item: (-item["amount"], item["category"]))
    return {"year": year, "month": month, "total": sum(item["amount"] for item in ordered), "items": ordered}


@app.get("/api/summary")
def get_summary(
    year: int = Query(ge=1, le=9999),
    month: int = Query(ge=1, le=12),
    type_: FilterType = Query(None, alias="type"),
    category: str | None = Query(None),
    q: str | None = Query(None),
):
    where, params = month_conditions(year, month, type_, category, q)
    with open_db("월별 요약을 불러오지 못했습니다.") as conn:
        income, expense = conn.execute(
            "SELECT "
            "COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0), "
            "COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) "
            f"FROM transactions WHERE {where}",
            params,
        ).fetchone()
    return {"year": year, "month": month, "income": income, "expense": expense, "balance": income - expense}


@app.post("/api/transactions", status_code=201)
def create_transaction(body: TransactionInput):
    created_at = datetime.now().isoformat(timespec="microseconds")
    with open_db("거래 내역을 저장하지 못했습니다.") as conn:
        with conn:
            cursor = conn.execute(
                "INSERT INTO transactions (date, type, amount, category, memo, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (body.date.isoformat(), body.type, body.amount, body.category, body.memo, created_at),
            )
        row = conn.execute(
            f"SELECT {TRANSACTION_COLUMNS} FROM transactions WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return dict(row)


@app.put("/api/transactions/{transaction_id}")
def update_transaction(body: TransactionInput, transaction_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("거래 내역을 수정하지 못했습니다.") as conn:
        with conn:
            cursor = conn.execute(
                "UPDATE transactions SET date = ?, type = ?, amount = ?, category = ?, memo = ? "
                "WHERE id = ?",
                (body.date.isoformat(), body.type, body.amount, body.category, body.memo, transaction_id),
            )
        if cursor.rowcount == 0:
            raise ApiError(404, "TRANSACTION_NOT_FOUND")
        row = conn.execute(
            f"SELECT {TRANSACTION_COLUMNS} FROM transactions WHERE id = ?", (transaction_id,)
        ).fetchone()
    return dict(row)


@app.delete("/api/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("거래 내역을 삭제하지 못했습니다.") as conn:
        with conn:
            cursor = conn.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
        if cursor.rowcount == 0:
            raise ApiError(404, "TRANSACTION_NOT_FOUND")
    return Response(status_code=204)


@app.get("/api/backup")
def download_backup():
    filename = datetime.now().strftime("budget-backup-%Y-%m-%d-%H%M.db")
    with open_db("백업 파일을 만들지 못했습니다.") as conn:
        # SQLite 백업 기능은 서버가 쓰는 중에도 깨지지 않은 복사본을 만든다.
        # 메모리 DB에 받아 바이트로 꺼내므로 서버 디스크에 임시 파일을 남기지 않는다.
        backup = sqlite3.connect(":memory:")
        try:
            conn.backup(backup)
            content = backup.serialize()
        finally:
            backup.close()
    return Response(
        content=content,
        media_type="application/vnd.sqlite3",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- v0.10 예산 ---

BUDGET_SELECT = (
    "SELECT b.category_id, c.name AS category, b.amount FROM budgets b "
    "JOIN categories c ON c.id = b.category_id"
)


@app.get("/api/budgets")
def list_budgets():
    with open_db("예산 목록을 불러오지 못했습니다.") as conn:
        rows = conn.execute(f"{BUDGET_SELECT} ORDER BY c.is_default DESC, c.id").fetchall()
    return [dict(row) for row in rows]


@app.put("/api/budgets/{category_id}")
def set_budget(body: BudgetInput, category_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("예산을 저장하지 못했습니다.") as conn:
        with conn:
            category = fetch_category(conn, category_id)
            if category is None:
                raise ApiError(404, "CATEGORY_NOT_FOUND")
            if category["type"] != "expense":
                raise ApiError(422, "INVALID_BUDGET_CATEGORY")
            conn.execute(
                "INSERT INTO budgets (category_id, amount) VALUES (?, ?) "
                "ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount",
                (category_id, body.amount),
            )
        row = conn.execute(f"{BUDGET_SELECT} WHERE b.category_id = ?", (category_id,)).fetchone()
    return dict(row)


@app.delete("/api/budgets/{category_id}", status_code=204)
def delete_budget(category_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("예산을 해제하지 못했습니다.") as conn:
        with conn:
            cursor = conn.execute("DELETE FROM budgets WHERE category_id = ?", (category_id,))
        if cursor.rowcount == 0:
            raise ApiError(404, "BUDGET_NOT_FOUND")
    return Response(status_code=204)


# --- v0.11 고정 거래 ---

RECURRING_SELECT = (
    "SELECT r.id, r.day, r.type, r.amount, r.category_id, c.name AS category, r.memo "
    "FROM recurring_transactions r JOIN categories c ON c.id = r.category_id"
)
RECURRING_ORDER = "ORDER BY r.day, r.created_at, r.id"


def recurring_to_dict(row, applied=None):
    return {**dict(row), "applied": applied}


@app.get("/api/recurring")
def list_recurring(
    year: int | None = Query(None, ge=1, le=9999),
    month: int | None = Query(None, ge=1, le=12),
):
    if (year is None) != (month is None):
        raise ApiError(422, "INVALID_QUERY", "조회할 연도와 월을 입력해 주세요.")
    with open_db("고정 거래를 불러오지 못했습니다.") as conn:
        rows = conn.execute(f"{RECURRING_SELECT} {RECURRING_ORDER}").fetchall()
        applied = None
        if year is not None:
            applied = {
                row[0]
                for row in conn.execute(
                    "SELECT recurring_id FROM recurring_applied WHERE year_month = ?", (f"{year:04d}-{month:02d}",)
                )
            }
    return [recurring_to_dict(row, None if applied is None else row["id"] in applied) for row in rows]


@app.post("/api/recurring", status_code=201)
def create_recurring(body: RecurringInput):
    created_at = datetime.now().isoformat(timespec="microseconds")
    with open_db("고정 거래를 저장하지 못했습니다.") as conn:
        with conn:
            cursor = conn.execute(
                "INSERT INTO recurring_transactions (day, type, amount, category_id, memo, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (body.day, body.type, body.amount, body.category_id, body.memo, created_at),
            )
        row = conn.execute(f"{RECURRING_SELECT} WHERE r.id = ?", (cursor.lastrowid,)).fetchone()
    return recurring_to_dict(row)


@app.put("/api/recurring/{recurring_id}")
def update_recurring(body: RecurringInput, recurring_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("고정 거래를 수정하지 못했습니다.") as conn:
        with conn:
            cursor = conn.execute(
                "UPDATE recurring_transactions SET day = ?, type = ?, amount = ?, category_id = ?, memo = ? "
                "WHERE id = ?",
                (body.day, body.type, body.amount, body.category_id, body.memo, recurring_id),
            )
        if cursor.rowcount == 0:
            raise ApiError(404, "RECURRING_NOT_FOUND")
        row = conn.execute(f"{RECURRING_SELECT} WHERE r.id = ?", (recurring_id,)).fetchone()
    return recurring_to_dict(row)


@app.delete("/api/recurring/{recurring_id}", status_code=204)
def delete_recurring(recurring_id: int = PathParam(ge=1, le=MAX_ID)):
    with open_db("고정 거래를 삭제하지 못했습니다.") as conn:
        with conn:
            cursor = conn.execute("DELETE FROM recurring_transactions WHERE id = ?", (recurring_id,))
            if cursor.rowcount == 0:
                raise ApiError(404, "RECURRING_NOT_FOUND")
            conn.execute("DELETE FROM recurring_applied WHERE recurring_id = ?", (recurring_id,))
    return Response(status_code=204)


@app.post("/api/recurring/apply")
def apply_recurring(body: RecurringApplyInput):
    year_month = f"{body.year:04d}-{body.month:02d}"
    last_day = calendar.monthrange(body.year, body.month)[1]
    created_at = datetime.now().isoformat(timespec="microseconds")
    created_ids, skipped = [], 0
    with open_db("고정 거래를 불러오지 못했습니다.") as conn:
        # 거래 추가와 불러온 기록을 한 트랜잭션에서 남겨, 중간에 실패하면 아무것도 들어가지 않는다.
        with conn:
            applied = {
                row[0]
                for row in conn.execute("SELECT recurring_id FROM recurring_applied WHERE year_month = ?", (year_month,))
            }
            for template in conn.execute(f"{RECURRING_SELECT} {RECURRING_ORDER}").fetchall():
                if template["id"] in applied:
                    skipped += 1
                    continue
                cursor = conn.execute(
                    "INSERT INTO transactions (date, type, amount, category, memo, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        f"{year_month}-{min(template['day'], last_day):02d}",
                        template["type"], template["amount"], template["category"], template["memo"], created_at,
                    ),
                )
                conn.execute(
                    "INSERT INTO recurring_applied (recurring_id, year_month) VALUES (?, ?)", (template["id"], year_month)
                )
                created_ids.append(cursor.lastrowid)
        created = [
            dict(conn.execute(f"SELECT {TRANSACTION_COLUMNS} FROM transactions WHERE id = ?", (tid,)).fetchone())
            for tid in created_ids
        ]
    return {"year": body.year, "month": body.month, "created": created, "skipped": skipped}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


# 화면 파일은 /static 아래에서만 제공한다. "/"에 마운트하면 /api 경로의 지원하지 않는
# 메서드 요청(예: GET /api/transactions/1)까지 화면 파일 쪽으로 넘어가 405 대신 404가 된다.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
