"""API 테스트 - docs/TEST_CASES.md 1장.

- 테스트마다 빈 임시 DB 파일을 BUDGET_DB_PATH로 지정한다. 실제 budget.db는 건드리지 않는다.
- DB 오류는 sqlite3.connect가 OperationalError를 일으키도록 바꿔서 만든다.
- API-COM-E03(에러 형식 통일)은 모든 에러 테스트의 assert_error에서 확인한다.
- API-COM-N04(JSON 응답)는 본문이 있는 모든 성공 테스트의 assert_json에서 확인한다.
"""

import importlib
import re
import sqlite3
import sys
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

REAL_CONNECT = sqlite3.connect
MAX_AMOUNT = 9007199254740991
REQUIRED_FIELDS = ["date", "type", "amount", "category"]
TRANSACTION_FIELDS = {"id", "date", "type", "amount", "category", "memo", "created_at"}

T1 = {"date": "2026-10-30", "type": "expense", "amount": 12500, "category": "식비", "memo": "점심"}
T2 = {"date": "2026-10-30", "type": "income", "amount": 3000000, "category": "월급"}
T3 = {"date": "2026-10-01", "type": "expense", "amount": 50000, "category": "교통"}
T4 = {"date": "2026-09-30", "type": "expense", "amount": 7000, "category": "쇼핑"}
T5 = {"date": "2026-11-01", "type": "income", "amount": 100000, "category": "용돈"}


# ---------------------------------------------------------------------------
# 준비
# ---------------------------------------------------------------------------

def fresh_app():
    """app 패키지를 새로 불러와 새 FastAPI 앱을 만든다."""
    for name in list(sys.modules):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]
    return importlib.import_module("app.main").app


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "test_budget.db"
    monkeypatch.setenv("BUDGET_DB_PATH", str(path))
    return path


@pytest.fixture
def client(db_path):
    with TestClient(fresh_app(), raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def broken_db(client, monkeypatch):
    def fail(*args, **kwargs):
        raise sqlite3.OperationalError("unable to open database file")

    monkeypatch.setattr(sqlite3, "connect", fail)


def assert_json(res, status):
    assert res.status_code == status, res.text
    assert res.headers["content-type"].startswith("application/json")
    return res.json()


def assert_error(res, status, code):
    assert res.status_code == status, res.text
    body = res.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    return body["error"]


def send(client, method, url, req):
    if "content" in req:
        return client.request(method, url, content=req["content"],
                               headers={"Content-Type": "application/json"})
    return client.request(method, url, json=req["json"])


def create(client, body):
    return assert_json(client.post("/api/transactions", json=body), 201)


def list_month(client, year, month):
    return assert_json(client.get("/api/transactions", params={"year": year, "month": month}), 200)


def get_summary(client, year, month):
    return assert_json(client.get("/api/summary", params={"year": year, "month": month}), 200)


def count_rows(db_path):
    conn = REAL_CONNECT(db_path)
    try:
        return conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    finally:
        conn.close()


def get_row(db_path, transaction_id):
    conn = REAL_CONNECT(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def with_fields(**fields):
    body = dict(T1)
    body.update(fields)
    return body


def without_field(name):
    body = dict(T1)
    del body[name]
    return body


# 등록·수정 본문 검증 실패 케이스 (API-POST-E01 ~ E16, API-PUT-E05에서 공통 사용)
INVALID_BODY_CASES = [
    pytest.param({"content": '{"date": "2026-10-30",'}, 400, "INVALID_JSON", id="E01-broken-json"),
    pytest.param({"json": []}, 400, "INVALID_JSON", id="E02-array"),
    pytest.param({"json": "abc"}, 400, "INVALID_JSON", id="E02-string"),
    *[pytest.param({"json": without_field(f)}, 422, "MISSING_FIELD", id=f"E03-missing-{f}")
      for f in REQUIRED_FIELDS],
    *[pytest.param({"json": with_fields(**{f: None})}, 422, "MISSING_FIELD", id=f"E04-null-{f}")
      for f in REQUIRED_FIELDS],
    *[pytest.param({"json": with_fields(date=d)}, 422, "INVALID_DATE", id=f"E05-date-{d}")
      for d in ["2026/10/30", "20261030", "2026-10-30T00:00:00"]],
    *[pytest.param({"json": with_fields(date=d)}, 422, "INVALID_DATE", id=f"E06-date-{d}")
      for d in ["2026-02-30", "2026-02-29", "2026-13-01"]],
    *[pytest.param({"json": with_fields(type=t)}, 422, "INVALID_TYPE", id=f"E07-type-{t!r}")
      for t in ["transfer", "Income", ""]],
    *[pytest.param({"json": with_fields(amount=a)}, 422, "INVALID_AMOUNT", id=f"E08-amount-{a}")
      for a in [0, -1]],
    pytest.param({"json": with_fields(amount=12.5)}, 422, "INVALID_AMOUNT", id="E09-amount-float"),
    pytest.param({"json": with_fields(amount="12500")}, 422, "INVALID_AMOUNT", id="E10-amount-string"),
    pytest.param({"json": with_fields(amount=True)}, 422, "INVALID_AMOUNT", id="E11-amount-bool"),
    pytest.param({"json": with_fields(amount=MAX_AMOUNT + 1)}, 422, "INVALID_AMOUNT", id="E12-amount-over-max"),
    pytest.param({"json": with_fields(type="income", category="식비")}, 422, "INVALID_CATEGORY",
                 id="E13-category-mismatch"),
    *[pytest.param({"json": with_fields(category=c)}, 422, "INVALID_CATEGORY", id=f"E14-category-{c!r}")
      for c in ["간식", ""]],
    *[pytest.param({"json": with_fields(memo=m)}, 422, "INVALID_MEMO", id=f"E15-memo-{m!r}")
      for m in [123, ["a"]]],
    pytest.param({"json": with_fields(date="2026-02-30", amount=0)}, 422, "INVALID_DATE",
                 id="E16-first-error-only"),
]


# ---------------------------------------------------------------------------
# 1.1 공통
# ---------------------------------------------------------------------------

def test_api_com_n01_index_page(client):
    res = client.get("/")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")


def test_api_com_n02_db_initialized_on_startup(client, db_path):
    conn = REAL_CONNECT(db_path)
    try:
        names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master")}
        defaults = conn.execute("SELECT COUNT(*) FROM categories WHERE is_default = 1").fetchone()[0]
    finally:
        conn.close()
    assert "transactions" in names
    assert "categories" in names
    assert "idx_transactions_date" in names
    assert defaults == 10


def test_api_com_n03_data_persists_after_restart(client, db_path):
    created = create(client, T1)
    with TestClient(fresh_app(), raise_server_exceptions=False) as restarted:
        assert list_month(restarted, 2026, 10) == [created]


def test_api_com_e01_unknown_path(client):
    assert_error(client.get("/api/unknown"), 404, "NOT_FOUND")


@pytest.mark.parametrize("method", ["PATCH", "GET"])
def test_api_com_e02_method_not_allowed(client, method):
    assert_error(client.request(method, "/api/transactions/1"), 405, "METHOD_NOT_ALLOWED")


def test_api_com_e04_500_message_hides_internals(client, db_path, broken_db):
    error = assert_error(client.get("/api/transactions", params={"year": 2026, "month": 10}),
                         500, "DATABASE_ERROR")
    message = error["message"]
    for hidden in ["OperationalError", "sqlite", "SELECT", "unable to open", str(db_path), db_path.name]:
        assert hidden not in message


# ---------------------------------------------------------------------------
# 1.2 GET /api/categories
# ---------------------------------------------------------------------------

EXPECTED_CATEGORIES = {
    "expense": ["식비", "교통", "주거", "쇼핑", "의료", "문화·여가", "기타"],
    "income": ["월급", "용돈", "기타"],
}


CATEGORY_FIELDS = {"id", "type", "name", "is_default"}

MVP_SCHEMA = """
CREATE TABLE transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount      INTEGER NOT NULL CHECK (amount >= 1),
    category    TEXT    NOT NULL,
    memo        TEXT,
    created_at  TEXT    NOT NULL
);
"""


def get_categories(client):
    return assert_json(client.get("/api/categories"), 200)


def category_names(body):
    return {type_: [c["name"] for c in body[type_]] for type_ in ("expense", "income")}


def add_category(client, type_, name):
    return assert_json(client.post("/api/categories", json={"type": type_, "name": name}), 201)


def find_category(client, type_, name):
    return next(c for c in get_categories(client)[type_] if c["name"] == name)


def count_categories(db_path):
    conn = REAL_CONNECT(db_path)
    try:
        return conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    finally:
        conn.close()


def get_category_row(db_path, category_id):
    conn = REAL_CONNECT(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def test_api_cat_n01_categories(client):
    body = get_categories(client)
    assert set(body) == {"expense", "income"}
    assert category_names(body) == EXPECTED_CATEGORIES
    for type_, items in body.items():
        for category in items:
            assert set(category) == CATEGORY_FIELDS
            assert isinstance(category["id"], int)
            assert category["type"] == type_
            assert category["is_default"] is True


def test_api_cat_n02_categories_fixed(client):
    t1 = create(client, T1)
    create(client, T2)
    client.put(f"/api/transactions/{t1['id']}", json=with_fields(amount=15000))
    client.delete(f"/api/transactions/{t1['id']}")
    assert category_names(get_categories(client)) == EXPECTED_CATEGORIES


def test_api_cat_n03_user_categories_after_defaults(client):
    add_category(client, "expense", "간식")
    add_category(client, "expense", "커피")
    expense = get_categories(client)["expense"]
    assert [c["name"] for c in expense] == EXPECTED_CATEGORIES["expense"] + ["간식", "커피"]
    assert [c["is_default"] for c in expense[-2:]] == [False, False]


def test_api_cat_n04_no_duplicate_defaults_after_restart(client, db_path):
    add_category(client, "expense", "간식")
    with TestClient(fresh_app(), raise_server_exceptions=False) as restarted:
        names = category_names(get_categories(restarted))
    assert names["expense"] == EXPECTED_CATEGORIES["expense"] + ["간식"]
    assert names["income"] == EXPECTED_CATEGORIES["income"]
    assert count_categories(db_path) == 11


def test_api_cat_n05_migrates_mvp_db(db_path):
    conn = REAL_CONNECT(db_path)
    try:
        with conn:
            conn.executescript(MVP_SCHEMA)
            conn.execute(
                "INSERT INTO transactions (date, type, amount, category, memo, created_at) "
                "VALUES ('2026-10-30', 'expense', 12500, '식비', '점심', '2026-10-30T12:00:00.000000')"
            )
    finally:
        conn.close()
    with TestClient(fresh_app(), raise_server_exceptions=False) as c:
        assert category_names(get_categories(c)) == EXPECTED_CATEGORIES
        [row] = list_month(c, 2026, 10)
        assert row["category"] == "식비"


def test_api_cat_e01_method_not_allowed(client):
    assert_error(client.patch("/api/categories", json={}), 405, "METHOD_NOT_ALLOWED")


def test_api_cat_e02_db_error(client, broken_db):
    assert_error(client.get("/api/categories"), 500, "DATABASE_ERROR")


# ---------------------------------------------------------------------------
# 1.3 GET /api/transactions
# ---------------------------------------------------------------------------

@pytest.fixture
def five(client):
    return [create(client, t) for t in (T1, T2, T3, T4, T5)]


def test_api_list_n01_month_filter(client, five):
    t1, t2, t3, _, _ = five
    ids = {t["id"] for t in list_month(client, 2026, 10)}
    assert ids == {t1["id"], t2["id"], t3["id"]}


def test_api_list_n02_month_boundaries(client, five):
    dates = {t["date"] for t in list_month(client, 2026, 10)}
    assert "2026-10-01" in dates and "2026-10-30" in dates
    assert "2026-09-30" not in dates and "2026-11-01" not in dates


def test_api_list_n03_year_boundary(client):
    dec = create(client, with_fields(date="2026-12-31"))
    create(client, with_fields(date="2027-01-01"))
    assert [t["id"] for t in list_month(client, 2026, 12)] == [dec["id"]]


def test_api_list_n04_sort_by_date_desc(client, five):
    dates = [t["date"] for t in list_month(client, 2026, 10)]
    assert dates == ["2026-10-30", "2026-10-30", "2026-10-01"]


def test_api_list_n05_same_date_later_created_first(client):
    t1 = create(client, T1)
    t2 = create(client, T2)
    assert [t["id"] for t in list_month(client, 2026, 10)] == [t2["id"], t1["id"]]


def test_api_list_n06_same_created_at_higher_id_first(client, db_path):
    conn = REAL_CONNECT(db_path)
    try:
        with conn:
            for _ in range(2):
                conn.execute(
                    "INSERT INTO transactions (date, type, amount, category, memo, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("2026-10-30", "expense", 1000, "식비", None, "2026-10-30T12:00:00.000000"),
                )
        first_id, second_id = [r[0] for r in conn.execute("SELECT id FROM transactions ORDER BY id")]
    finally:
        conn.close()
    assert [t["id"] for t in list_month(client, 2026, 10)] == [second_id, first_id]


def test_api_list_n07_empty_month(client, five):
    assert list_month(client, 2026, 8) == []


def test_api_list_n08_response_fields(client):
    create(client, T2)
    [t2] = list_month(client, 2026, 10)
    assert set(t2) == TRANSACTION_FIELDS
    assert t2["memo"] is None


@pytest.mark.parametrize("params", [
    pytest.param({"month": 10}, id="E01-no-year"),
    pytest.param({"year": 2026}, id="E02-no-month"),
    pytest.param({"year": 2026, "month": 0}, id="E03-month-0"),
    pytest.param({"year": 2026, "month": 13}, id="E03-month-13"),
    pytest.param({"year": 0, "month": 10}, id="E04-year-0"),
    pytest.param({"year": 10000, "month": 10}, id="E04-year-10000"),
    pytest.param({"year": "abc", "month": 10}, id="E05-year-abc"),
    pytest.param({"year": 2026, "month": "1.5"}, id="E05-month-1.5"),
])
def test_api_list_e01_e05_invalid_query(client, params):
    assert_error(client.get("/api/transactions", params=params), 422, "INVALID_QUERY")


def test_api_list_e06_db_error(client, broken_db):
    assert_error(client.get("/api/transactions", params={"year": 2026, "month": 10}),
                 500, "DATABASE_ERROR")


# ---------------------------------------------------------------------------
# 1.4 POST /api/transactions
# ---------------------------------------------------------------------------

def test_api_post_n01_create(client, db_path):
    created = create(client, T1)
    assert set(created) == TRANSACTION_FIELDS
    for key, value in T1.items():
        assert created[key] == value
    assert isinstance(created["id"], int)
    assert isinstance(created["created_at"], str)
    assert count_rows(db_path) == 1


def test_api_post_n02_memo_omitted(client):
    assert create(client, T2)["memo"] is None


@pytest.mark.parametrize("memo", ["", "   ", None])
def test_api_post_n03_blank_memo_is_null(client, memo):
    assert create(client, with_fields(memo=memo))["memo"] is None


def test_api_post_n04_memo_trimmed(client):
    assert create(client, with_fields(memo="  점심  "))["memo"] == "점심"


def test_api_post_n05_min_amount(client):
    assert create(client, with_fields(amount=1))["amount"] == 1


def test_api_post_n06_max_amount(client):
    created = create(client, with_fields(amount=MAX_AMOUNT))
    assert created["amount"] == MAX_AMOUNT
    assert list_month(client, 2026, 10)[0]["amount"] == MAX_AMOUNT


def test_api_post_n07_server_fields_ignored(client):
    before = datetime.now() - timedelta(seconds=1)
    created = create(client, with_fields(id=999, created_at="2000-01-01T00:00:00"))
    after = datetime.now() + timedelta(seconds=1)
    assert created["id"] != 999
    assert before <= datetime.fromisoformat(created["created_at"]) <= after


def test_api_post_n08_unknown_field_ignored(client):
    created = create(client, with_fields(title="점심"))
    assert "title" not in created
    assert "title" not in list_month(client, 2026, 10)[0]


@pytest.mark.parametrize("body", [
    {**T1, "type": "expense", "category": "기타"},
    {**T2, "type": "income", "category": "기타"},
])
def test_api_post_n09_shared_category(client, body):
    assert create(client, body)["category"] == "기타"


def test_api_post_n10_leap_day(client):
    assert create(client, with_fields(date="2028-02-29"))["date"] == "2028-02-29"


def test_api_post_n11_created_at_format(client):
    created_at = create(client, T1)["created_at"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}", created_at)


def test_api_post_n12_reflected_immediately(client):
    before = get_summary(client, 2026, 10)["expense"]
    created = create(client, T1)
    assert created in list_month(client, 2026, 10)
    assert get_summary(client, 2026, 10)["expense"] == before + 12500


@pytest.mark.parametrize("req, status, code", INVALID_BODY_CASES)
def test_api_post_e01_e17_invalid_body_not_saved(client, db_path, req, status, code):
    assert_error(send(client, "POST", "/api/transactions", req), status, code)
    assert count_rows(db_path) == 0


def test_api_post_e18_db_error(client, db_path, broken_db):
    assert_error(client.post("/api/transactions", json=T1), 500, "DATABASE_ERROR")
    assert count_rows(db_path) == 0


# ---------------------------------------------------------------------------
# 1.5 PUT /api/transactions/{id}
# ---------------------------------------------------------------------------

@pytest.fixture
def t1(client):
    return create(client, T1)


def put(client, transaction_id, body):
    return client.put(f"/api/transactions/{transaction_id}", json=body)


def test_api_put_n01_update(client, t1):
    updated = assert_json(put(client, t1["id"], with_fields(amount=15000, memo="저녁")), 200)
    assert updated["amount"] == 15000
    assert updated["memo"] == "저녁"
    assert updated["id"] == t1["id"]
    assert updated["created_at"] == t1["created_at"]


def test_api_put_n02_memo_omitted_becomes_null(client, t1):
    assert assert_json(put(client, t1["id"], without_field("memo")), 200)["memo"] is None


def test_api_put_n03_change_type(client, t1):
    updated = assert_json(put(client, t1["id"], with_fields(type="income", category="월급")), 200)
    assert updated["type"] == "income"
    assert updated["category"] == "월급"


def test_api_put_n04_move_to_other_month(client, t1):
    oct_before = get_summary(client, 2026, 10)["expense"]
    nov_before = get_summary(client, 2026, 11)["expense"]
    assert_json(put(client, t1["id"], with_fields(date="2026-11-02")), 200)
    assert t1["id"] not in [t["id"] for t in list_month(client, 2026, 10)]
    assert t1["id"] in [t["id"] for t in list_month(client, 2026, 11)]
    assert get_summary(client, 2026, 10)["expense"] == oct_before - 12500
    assert get_summary(client, 2026, 11)["expense"] == nov_before + 12500


def test_api_put_n05_server_fields_ignored(client, t1):
    updated = assert_json(put(client, t1["id"], with_fields(id=999, created_at="2000-01-01T00:00:00")), 200)
    assert updated["id"] == t1["id"]
    assert updated["created_at"] == t1["created_at"]


def test_api_put_n06_sort_kept_after_update(client, t1):
    t2 = create(client, T2)
    assert_json(put(client, t1["id"], with_fields(amount=15000)), 200)
    assert [t["id"] for t in list_month(client, 2026, 10)] == [t2["id"], t1["id"]]


@pytest.mark.parametrize("bad_id", ["abc", "0", "-1", "9223372036854775808"])
def test_api_put_e01_invalid_id(client, db_path, t1, bad_id):
    before = get_row(db_path, t1["id"])
    assert_error(put(client, bad_id, with_fields(amount=15000)), 422, "INVALID_ID")
    assert get_row(db_path, t1["id"]) == before


def test_api_put_e02_not_found(client, db_path, t1):
    before = get_row(db_path, t1["id"])
    assert_error(put(client, 9999, T1), 404, "TRANSACTION_NOT_FOUND")
    assert get_row(db_path, t1["id"]) == before


def test_api_put_e03_invalid_id_checked_first(client):
    assert_error(put(client, "abc", with_fields(amount=0)), 422, "INVALID_ID")


def test_api_put_e04_body_checked_before_existence(client):
    assert_error(put(client, 9999, with_fields(amount=0)), 422, "INVALID_AMOUNT")


@pytest.mark.parametrize("req, status, code", INVALID_BODY_CASES)
def test_api_put_e05_e07_invalid_body_not_changed(client, db_path, t1, req, status, code):
    before = get_row(db_path, t1["id"])
    assert_error(send(client, "PUT", f"/api/transactions/{t1['id']}", req), status, code)
    assert get_row(db_path, t1["id"]) == before


def test_api_put_e06_category_mismatch(client, db_path, t1):
    before = get_row(db_path, t1["id"])
    assert_error(put(client, t1["id"], with_fields(type="income")), 422, "INVALID_CATEGORY")
    assert get_row(db_path, t1["id"]) == before


def test_api_put_e08_db_error(client, db_path, t1, broken_db):
    before = get_row(db_path, t1["id"])
    assert_error(put(client, t1["id"], with_fields(amount=15000)), 500, "DATABASE_ERROR")
    assert get_row(db_path, t1["id"]) == before


# ---------------------------------------------------------------------------
# 1.6 DELETE /api/transactions/{id}
# ---------------------------------------------------------------------------

def test_api_del_n01_delete(client, t1):
    res = client.delete(f"/api/transactions/{t1['id']}")
    assert res.status_code == 204
    assert res.content == b""
    assert list_month(client, 2026, 10) == []


def test_api_del_n02_summary_reflected(client, t1):
    before = get_summary(client, 2026, 10)["expense"]
    client.delete(f"/api/transactions/{t1['id']}")
    assert get_summary(client, 2026, 10)["expense"] == before - 12500


def test_api_del_n03_other_transactions_kept(client, t1):
    t2 = create(client, T2)
    t3 = create(client, T3)
    client.delete(f"/api/transactions/{t1['id']}")
    assert [t["id"] for t in list_month(client, 2026, 10)] == [t2["id"], t3["id"]]


@pytest.mark.parametrize("bad_id", ["abc", "0", "-1", "9223372036854775808"])
def test_api_del_e01_invalid_id(client, bad_id):
    assert_error(client.delete(f"/api/transactions/{bad_id}"), 422, "INVALID_ID")


def test_api_del_e02_not_found(client):
    assert_error(client.delete("/api/transactions/9999"), 404, "TRANSACTION_NOT_FOUND")


def test_api_del_e03_delete_twice(client, t1):
    assert client.delete(f"/api/transactions/{t1['id']}").status_code == 204
    assert_error(client.delete(f"/api/transactions/{t1['id']}"), 404, "TRANSACTION_NOT_FOUND")


def test_api_del_e04_db_error(client, db_path, t1, broken_db):
    assert_error(client.delete(f"/api/transactions/{t1['id']}"), 500, "DATABASE_ERROR")
    assert get_row(db_path, t1["id"]) is not None


# ---------------------------------------------------------------------------
# 1.7 GET /api/summary
# ---------------------------------------------------------------------------

def test_api_sum_n01_totals(client, five):
    summary = get_summary(client, 2026, 10)
    assert summary["income"] == 3000000
    assert summary["expense"] == 62500
    assert summary["balance"] == 2937500


def test_api_sum_n02_other_months_excluded(client, five):
    assert get_summary(client, 2026, 9) == {"year": 2026, "month": 9, "income": 0, "expense": 7000, "balance": -7000}
    assert get_summary(client, 2026, 11) == {"year": 2026, "month": 11, "income": 100000, "expense": 0, "balance": 100000}


def test_api_sum_n03_empty_month(client):
    assert get_summary(client, 2026, 8) == {"year": 2026, "month": 8, "income": 0, "expense": 0, "balance": 0}


def test_api_sum_n04_negative_balance(client, t1):
    assert get_summary(client, 2026, 10) == {
        "year": 2026, "month": 10, "income": 0, "expense": 12500, "balance": -12500,
    }


def test_api_sum_n05_response_fields(client, five):
    summary = get_summary(client, 2026, 10)
    assert summary["year"] == 2026
    assert summary["month"] == 10


@pytest.mark.parametrize("params", [
    pytest.param({"month": 10}, id="E01-no-year"),
    pytest.param({"year": 2026}, id="E01-no-month"),
    pytest.param({"year": 2026, "month": 13}, id="E02-month-13"),
    pytest.param({"year": 0, "month": 10}, id="E02-year-0"),
    pytest.param({"year": 2026, "month": "abc"}, id="E03-month-abc"),
])
def test_api_sum_e01_e03_invalid_query(client, params):
    assert_error(client.get("/api/summary", params=params), 422, "INVALID_QUERY")


def test_api_sum_e04_db_error(client, broken_db):
    assert_error(client.get("/api/summary", params={"year": 2026, "month": 10}), 500, "DATABASE_ERROR")


# ---------------------------------------------------------------------------
# 1.8 POST /api/categories (v0.4)
# ---------------------------------------------------------------------------

LONG_NAME_20 = "가" * 20
LONG_NAME_21 = "가" * 21

# 분류 이름 검증 실패 케이스 (API-CADD-E04 ~ E06, API-CREN-E06에서 공통 사용)
INVALID_NAME_CASES = [
    pytest.param({"content": '{"name": "간식",'}, 400, "INVALID_JSON", id="broken-json"),
    pytest.param({"json": []}, 400, "INVALID_JSON", id="array"),
    pytest.param({"json": {}}, 422, "MISSING_FIELD", id="missing-name"),
    pytest.param({"json": {"name": None}}, 422, "MISSING_FIELD", id="null-name"),
    pytest.param({"json": {"name": ""}}, 422, "INVALID_CATEGORY_NAME", id="empty"),
    pytest.param({"json": {"name": "   "}}, 422, "INVALID_CATEGORY_NAME", id="blank"),
    pytest.param({"json": {"name": LONG_NAME_21}}, 422, "INVALID_CATEGORY_NAME", id="21-chars"),
    pytest.param({"json": {"name": 123}}, 422, "INVALID_CATEGORY_NAME", id="number"),
    pytest.param({"json": {"name": ["a"]}}, 422, "INVALID_CATEGORY_NAME", id="list"),
]


def with_type(req, type_="expense"):
    """분류 추가 요청에 type을 붙인다. 깨진 JSON이나 객체가 아닌 본문은 그대로 둔다."""
    if "json" in req and isinstance(req["json"], dict):
        return {"json": {"type": type_, **req["json"]}}
    return req


def test_api_cadd_n01_add(client):
    created = assert_json(client.post("/api/categories", json={"type": "expense", "name": "간식"}), 201)
    assert set(created) == CATEGORY_FIELDS
    assert created["type"] == "expense"
    assert created["name"] == "간식"
    assert created["is_default"] is False
    assert created in get_categories(client)["expense"]


def test_api_cadd_n02_name_trimmed(client):
    assert add_category(client, "expense", "  간식  ")["name"] == "간식"


def test_api_cadd_n03_same_name_other_type(client):
    add_category(client, "expense", "부업")
    add_category(client, "income", "부업")


def test_api_cadd_n04_max_length(client):
    assert add_category(client, "expense", LONG_NAME_20)["name"] == LONG_NAME_20


def test_api_cadd_n05_usable_in_transactions(client):
    add_category(client, "expense", "간식")
    assert create(client, with_fields(category="간식"))["category"] == "간식"
    assert_error(client.post("/api/transactions", json={**T2, "category": "간식"}), 422, "INVALID_CATEGORY")


def test_api_cadd_n06_server_fields_ignored(client):
    res = client.post("/api/categories", json={"type": "expense", "name": "간식", "is_default": True, "id": 999})
    created = assert_json(res, 201)
    assert created["is_default"] is False
    assert created["id"] != 999


@pytest.mark.parametrize("req, status, code", [
    *[pytest.param(with_type(p.values[0]), *p.values[1:], id=p.id) for p in INVALID_NAME_CASES],
    pytest.param({"json": {"name": "간식"}}, 422, "MISSING_FIELD", id="missing-type"),
    pytest.param({"json": {"type": None, "name": "간식"}}, 422, "MISSING_FIELD", id="null-type"),
    pytest.param({"json": {"type": "transfer", "name": "간식"}}, 422, "INVALID_TYPE", id="bad-type"),
])
def test_api_cadd_e01_e06_e09_invalid_body_not_saved(client, db_path, req, status, code):
    before = count_categories(db_path)
    assert_error(send(client, "POST", "/api/categories", req), status, code)
    assert count_categories(db_path) == before


def test_api_cadd_e07_duplicate_default(client, db_path):
    before = count_categories(db_path)
    error = assert_error(client.post("/api/categories", json={"type": "expense", "name": "식비"}),
                         409, "DUPLICATE_CATEGORY")
    assert "식비" in error["message"]
    assert count_categories(db_path) == before


def test_api_cadd_e08_duplicate_user_category(client, db_path):
    add_category(client, "expense", "간식")
    before = count_categories(db_path)
    assert_error(client.post("/api/categories", json={"type": "expense", "name": " 간식 "}),
                 409, "DUPLICATE_CATEGORY")
    assert count_categories(db_path) == before


def test_api_cadd_e10_db_error(client, db_path, broken_db):
    assert_error(client.post("/api/categories", json={"type": "expense", "name": "간식"}),
                 500, "DATABASE_ERROR")
    assert count_categories(db_path) == 10


# ---------------------------------------------------------------------------
# 1.9 PUT /api/categories/{id} (v0.4)
# ---------------------------------------------------------------------------

@pytest.fixture
def snack(client):
    """지출 간식(C1)과 그 거래 2건, 수입 간식(C2)과 그 거래 1건."""
    c1 = add_category(client, "expense", "간식")
    c2 = add_category(client, "income", "간식")
    t_oct = create(client, with_fields(category="간식"))
    t_nov = create(client, with_fields(category="간식", date="2026-11-02"))
    t_income = create(client, {**T2, "category": "간식"})
    return {"c1": c1, "c2": c2, "t_oct": t_oct, "t_nov": t_nov, "t_income": t_income}


def rename(client, category_id, body):
    return client.put(f"/api/categories/{category_id}", json=body)


def assert_snack_unchanged(db_path, snack):
    assert get_category_row(db_path, snack["c1"]["id"])["name"] == "간식"
    for key in ("t_oct", "t_nov", "t_income"):
        assert get_row(db_path, snack[key]["id"])["category"] == "간식"


def test_api_cren_n01_rename(client, snack):
    renamed = assert_json(rename(client, snack["c1"]["id"], {"name": "커피·간식"}), 200)
    assert renamed == {**snack["c1"], "name": "커피·간식"}


def test_api_cren_n02_transactions_follow_rename(client, db_path, snack):
    assert_json(rename(client, snack["c1"]["id"], {"name": "커피·간식"}), 200)
    assert get_row(db_path, snack["t_oct"]["id"])["category"] == "커피·간식"
    assert get_row(db_path, snack["t_nov"]["id"])["category"] == "커피·간식"
    assert get_row(db_path, snack["t_income"]["id"])["category"] == "간식"
    oct_categories = {t["id"]: t["category"] for t in list_month(client, 2026, 10)}
    assert oct_categories[snack["t_oct"]["id"]] == "커피·간식"
    assert oct_categories[snack["t_income"]["id"]] == "간식"


def test_api_cren_n03_same_name(client, db_path, snack):
    assert assert_json(rename(client, snack["c1"]["id"], {"name": "간식"}), 200) == snack["c1"]
    assert_snack_unchanged(db_path, snack)


def test_api_cren_n04_name_trimmed(client, snack):
    assert assert_json(rename(client, snack["c1"]["id"], {"name": "  커피  "}), 200)["name"] == "커피"


def test_api_cren_n05_type_ignored(client, snack):
    renamed = assert_json(rename(client, snack["c1"]["id"], {"name": "커피", "type": "income"}), 200)
    assert renamed["type"] == "expense"


@pytest.mark.parametrize("bad_id", ["abc", "0", "-1", "9223372036854775808"])
def test_api_cren_e01_invalid_id(client, db_path, snack, bad_id):
    assert_error(rename(client, bad_id, {"name": "커피"}), 422, "INVALID_ID")
    assert_snack_unchanged(db_path, snack)


def test_api_cren_e02_not_found(client, db_path, snack):
    assert_error(rename(client, 9999, {"name": "커피"}), 404, "CATEGORY_NOT_FOUND")
    assert_snack_unchanged(db_path, snack)


def test_api_cren_e03_default_locked(client, db_path):
    food = find_category(client, "expense", "식비")
    t1 = create(client, T1)
    assert_error(rename(client, food["id"], {"name": "밥"}), 409, "DEFAULT_CATEGORY_LOCKED")
    assert get_category_row(db_path, food["id"])["name"] == "식비"
    assert get_row(db_path, t1["id"])["category"] == "식비"


def test_api_cren_e04_duplicate_default(client, db_path, snack):
    assert_error(rename(client, snack["c1"]["id"], {"name": "식비"}), 409, "DUPLICATE_CATEGORY")
    assert_snack_unchanged(db_path, snack)


def test_api_cren_e05_duplicate_user_category(client, db_path, snack):
    add_category(client, "expense", "커피")
    assert_error(rename(client, snack["c1"]["id"], {"name": "커피"}), 409, "DUPLICATE_CATEGORY")
    assert_snack_unchanged(db_path, snack)


@pytest.mark.parametrize("req, status, code", INVALID_NAME_CASES)
def test_api_cren_e06_e08_invalid_body(client, db_path, snack, req, status, code):
    assert_error(send(client, "PUT", f"/api/categories/{snack['c1']['id']}", req), status, code)
    assert_snack_unchanged(db_path, snack)


def test_api_cren_e07_body_checked_before_existence(client):
    assert_error(rename(client, 9999, {"name": ""}), 422, "INVALID_CATEGORY_NAME")


def test_api_cren_e09_rollback_on_partial_failure(client, db_path, snack):
    conn = REAL_CONNECT(db_path)
    try:
        conn.execute(
            "CREATE TRIGGER fail_transaction_update BEFORE UPDATE ON transactions "
            "BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
        )
        conn.commit()
    finally:
        conn.close()
    assert_error(rename(client, snack["c1"]["id"], {"name": "커피·간식"}), 500, "DATABASE_ERROR")
    assert_snack_unchanged(db_path, snack)


def test_api_cren_e10_db_error(client, db_path, snack, broken_db):
    assert_error(rename(client, snack["c1"]["id"], {"name": "커피"}), 500, "DATABASE_ERROR")
    assert_snack_unchanged(db_path, snack)


# ---------------------------------------------------------------------------
# 1.10 DELETE /api/categories/{id} (v0.4)
# ---------------------------------------------------------------------------

def delete_category(client, category_id):
    return client.delete(f"/api/categories/{category_id}")


def test_api_cdel_n01_delete(client, db_path):
    snack_category = add_category(client, "expense", "간식")
    res = delete_category(client, snack_category["id"])
    assert res.status_code == 204
    assert res.content == b""
    assert "간식" not in category_names(get_categories(client))["expense"]
    assert get_category_row(db_path, snack_category["id"]) is None


def test_api_cdel_n02_other_type_usage_ignored(client, db_path):
    expense_side = add_category(client, "expense", "부업")
    income_side = add_category(client, "income", "부업")
    t = create(client, {**T2, "category": "부업"})
    assert delete_category(client, expense_side["id"]).status_code == 204
    assert get_category_row(db_path, income_side["id"]) is not None
    assert get_row(db_path, t["id"])["category"] == "부업"


@pytest.mark.parametrize("bad_id", ["abc", "0", "-1", "9223372036854775808"])
def test_api_cdel_e01_invalid_id(client, bad_id):
    assert_error(delete_category(client, bad_id), 422, "INVALID_ID")


def test_api_cdel_e02_not_found(client):
    assert_error(delete_category(client, 9999), 404, "CATEGORY_NOT_FOUND")


def test_api_cdel_e03_delete_twice(client):
    snack_category = add_category(client, "expense", "간식")
    assert delete_category(client, snack_category["id"]).status_code == 204
    assert_error(delete_category(client, snack_category["id"]), 404, "CATEGORY_NOT_FOUND")


def test_api_cdel_e04_default_locked(client, db_path):
    food = find_category(client, "expense", "식비")
    assert_error(delete_category(client, food["id"]), 409, "DEFAULT_CATEGORY_LOCKED")
    assert get_category_row(db_path, food["id"]) is not None


def test_api_cdel_e05_in_use(client, db_path):
    snack_category = add_category(client, "expense", "간식")
    t_a = create(client, with_fields(category="간식"))
    t_b = create(client, with_fields(category="간식", date="2026-11-02"))
    error = assert_error(delete_category(client, snack_category["id"]), 409, "CATEGORY_IN_USE")
    assert "2건" in error["message"]
    assert get_category_row(db_path, snack_category["id"]) is not None
    assert get_row(db_path, t_a["id"])["category"] == "간식"
    assert get_row(db_path, t_b["id"])["category"] == "간식"


def test_api_cdel_e06_db_error(client, db_path):
    snack_category = add_category(client, "expense", "간식")

    def fail(*args, **kwargs):
        raise sqlite3.OperationalError("unable to open database file")

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(sqlite3, "connect", fail)
        assert_error(delete_category(client, snack_category["id"]), 500, "DATABASE_ERROR")
    assert get_category_row(db_path, snack_category["id"]) is not None


# ---------------------------------------------------------------------------
# 1.11 GET /api/backup (v0.5)
# ---------------------------------------------------------------------------

BACKUP_FILENAME = re.compile(r'attachment; filename="budget-backup-(\d{4}-\d{2}-\d{2}-\d{4})\.db"')


def download_backup(client, tmp_path):
    """백업을 받아 파일로 저장하고 (응답, 파일 경로)를 돌려준다."""
    res = client.get("/api/backup")
    assert res.status_code == 200, res.text
    path = tmp_path / "downloaded-backup.db"
    path.write_bytes(res.content)
    return res, path


def table_rows(path, table):
    conn = REAL_CONNECT(path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY id")]
    finally:
        conn.close()


@pytest.fixture
def filled(client):
    for t in (T1, T2, T3, T4, T5):
        create(client, t)
    add_category(client, "expense", "간식")


def test_api_bak_n01_download_response(client, tmp_path):
    before = datetime.now().replace(second=0, microsecond=0)
    res, _ = download_backup(client, tmp_path)
    after = datetime.now()
    assert res.headers["content-type"].startswith("application/vnd.sqlite3")
    match = BACKUP_FILENAME.fullmatch(res.headers["content-disposition"])
    assert match, res.headers["content-disposition"]
    stamp = datetime.strptime(match.group(1), "%Y-%m-%d-%H%M")
    assert before <= stamp <= after


def test_api_bak_n02_content_matches(client, db_path, tmp_path, filled):
    _, path = download_backup(client, tmp_path)
    assert path.read_bytes().startswith(b"SQLite format 3\x00")
    for table in ("transactions", "categories"):
        assert table_rows(path, table) == table_rows(db_path, table)
    assert len(table_rows(path, "transactions")) == 5
    assert len(table_rows(path, "categories")) == 11


def test_api_bak_n03_restorable(client, tmp_path, monkeypatch, filled):
    original_list = list_month(client, 2026, 10)
    original_summary = get_summary(client, 2026, 10)
    original_categories = get_categories(client)
    _, path = download_backup(client, tmp_path)

    monkeypatch.setenv("BUDGET_DB_PATH", str(path))
    with TestClient(fresh_app(), raise_server_exceptions=False) as restored:
        assert list_month(restored, 2026, 10) == original_list
        assert get_summary(restored, 2026, 10) == original_summary
        assert get_categories(restored) == original_categories


def test_api_bak_n04_original_unchanged(client, db_path, tmp_path, filled):
    before = {table: table_rows(db_path, table) for table in ("transactions", "categories")}
    download_backup(client, tmp_path)
    assert {table: table_rows(db_path, table) for table in ("transactions", "categories")} == before
    create(client, with_fields(date="2026-10-02"))
    assert count_rows(db_path) == 6


def test_api_bak_n05_empty_db(client, tmp_path):
    _, path = download_backup(client, tmp_path)
    assert table_rows(path, "transactions") == []
    assert len(table_rows(path, "categories")) == 10


def test_api_bak_e01_db_error(client, broken_db):
    assert_error(client.get("/api/backup"), 500, "DATABASE_ERROR")


def test_api_bak_e02_method_not_allowed(client):
    assert_error(client.post("/api/backup"), 405, "METHOD_NOT_ALLOWED")
