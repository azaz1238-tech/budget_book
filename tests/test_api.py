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
    finally:
        conn.close()
    assert "transactions" in names
    assert "idx_transactions_date" in names


def test_api_com_n03_data_persists_after_restart(client, db_path):
    created = create(client, T1)
    with TestClient(fresh_app(), raise_server_exceptions=False) as restarted:
        assert list_month(restarted, 2026, 10) == [created]


def test_api_com_e01_unknown_path(client):
    assert_error(client.get("/api/unknown"), 404, "NOT_FOUND")


def test_api_com_e02_method_not_allowed(client):
    assert_error(client.patch("/api/transactions/1", json=T1), 405, "METHOD_NOT_ALLOWED")


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


def test_api_cat_n01_categories(client):
    assert assert_json(client.get("/api/categories"), 200) == EXPECTED_CATEGORIES


def test_api_cat_n02_categories_fixed(client):
    t1 = create(client, T1)
    create(client, T2)
    client.put(f"/api/transactions/{t1['id']}", json=with_fields(amount=15000))
    client.delete(f"/api/transactions/{t1['id']}")
    assert assert_json(client.get("/api/categories"), 200) == EXPECTED_CATEGORIES


def test_api_cat_e01_cannot_add_category(client):
    assert_error(client.post("/api/categories", json={"expense": ["간식"]}), 405, "METHOD_NOT_ALLOWED")


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


@pytest.mark.parametrize("bad_id", ["abc", "0", "-1"])
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


@pytest.mark.parametrize("bad_id", ["abc", "0", "-1"])
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
