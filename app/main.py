import logging
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.categories import categories_as_lists
from app.db import init_db

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# 입력값 검사 순서 (API_SPEC 1.2절). 에러가 여러 개면 이 순서로 첫 번째만 돌려준다.
FIELD_ORDER = ["date", "type", "amount", "category", "memo"]
REQUIRED_FIELDS = {"date", "type", "amount", "category"}

FIELD_ERROR_CODES = {
    "date": "INVALID_DATE",
    "type": "INVALID_TYPE",
    "amount": "INVALID_AMOUNT",
    "category": "INVALID_CATEGORY",
    "memo": "INVALID_MEMO",
}

MISSING_MESSAGES = {
    "date": "거래일을 입력해 주세요.",
    "type": "거래 유형을 선택해 주세요.",
    "amount": "금액을 입력해 주세요.",
    "category": "분류를 선택해 주세요.",
}

MESSAGES = {
    "INVALID_JSON": "요청 형식이 올바르지 않습니다.",
    "INVALID_DATE": "거래일이 올바른 날짜가 아닙니다.",
    "INVALID_TYPE": "거래 유형은 수입 또는 지출이어야 합니다.",
    "INVALID_AMOUNT": "금액은 1 이상의 정수여야 합니다.",
    "INVALID_CATEGORY": "분류가 올바르지 않습니다.",
    "INVALID_MEMO": "메모는 문자열이어야 합니다.",
    "INVALID_ID": "거래 ID가 올바르지 않습니다.",
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
    status_code, code, message = classify_validation_errors(exc.errors())
    return error_response(status_code, code, message)


@app.exception_handler(sqlite3.Error)
async def handle_database_error(request: Request, exc: sqlite3.Error):
    logger.exception("Database error on %s %s", request.method, request.url.path)
    return error_response(500, "DATABASE_ERROR")


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception):
    logger.exception("Unexpected error on %s %s", request.method, request.url.path)
    return error_response(500, "INTERNAL_ERROR")


def classify_validation_errors(errors):
    """FastAPI 검증 에러 목록을 (상태 코드, code, message) 하나로 바꾼다."""
    path_errors = [e for e in errors if e["loc"][0] == "path"]
    if path_errors:
        return 422, "INVALID_ID", None

    query_errors = [e for e in errors if e["loc"][0] == "query"]
    if query_errors:
        if any(e["type"] == "missing" for e in query_errors):
            return 422, "INVALID_QUERY", "조회할 연도와 월을 입력해 주세요."
        if any(e["loc"][-1] == "month" for e in query_errors):
            return 422, "INVALID_QUERY", "월은 1부터 12 사이여야 합니다."
        return 422, "INVALID_QUERY", "연도는 1부터 9999 사이여야 합니다."

    # 본문이 깨진 JSON이거나 JSON 객체가 아닌 경우
    if any(e["type"] == "json_invalid" or tuple(e["loc"]) == ("body",) for e in errors):
        return 400, "INVALID_JSON", None

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


@app.get("/api/categories")
def get_categories():
    return categories_as_lists()


# API 경로를 먼저 등록하고, 나머지 경로는 화면 파일로 처리한다.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
