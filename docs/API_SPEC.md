# API 명세 초안 - 개인 가계부

> 기준 문서: `docs/DATA_MODEL.md` (보조: `docs/PRD.md`, `docs/SPEC.md`, `docs/TRD.md`)
> 대상 범위: MVP(v0.1 ~ v0.3), v0.4 사용자 분류 편집(3.7 ~ 3.9절), v0.5 백업(3.10절), v0.6 분류 필터(3.2·3.6절 쿼리), v0.8 ~ v0.11 예정(3.11 ~ 3.19절, v0.9는 3.2·3.6절 쿼리 변경, 아직 구현 전)

## 1. 공통 규칙

- 기본 주소: `http://127.0.0.1:8000`
- 모든 API 경로는 `/api`로 시작한다.
- 요청·응답 본문은 JSON(`Content-Type: application/json`, UTF-8)이다. 예외: `GET /api/backup`의 성공 응답은 SQLite 파일이다. (에러 응답은 JSON)
- 인증은 없다.
- 날짜는 `YYYY-MM-DD`, 시각은 ISO 8601(`2026-10-30T12:34:56.123456`) 문자열이다.
- 금액은 원 단위 정수다.

### 1.1 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/categories` | 분류 목록 조회 (v0.4에서 응답 모양 변경) |
| GET | `/api/transactions` | 월별 거래 목록 조회 |
| POST | `/api/transactions` | 거래 등록 |
| PUT | `/api/transactions/{id}` | 거래 수정 |
| DELETE | `/api/transactions/{id}` | 거래 삭제 |
| GET | `/api/summary` | 월별 요약 조회 |
| POST | `/api/categories` | 분류 추가 (v0.4) |
| PUT | `/api/categories/{id}` | 사용자 분류 이름 수정 (v0.4) |
| DELETE | `/api/categories/{id}` | 사용자 분류 삭제 (v0.4) |
| GET | `/api/backup` | 데이터베이스 백업 파일 다운로드 (v0.5) |
| GET | `/api/summary/categories` | 분류별 지출 합계 (v0.8, v0.10에서 예산 정보 추가) |
| GET | `/api/budgets` | 예산 목록 (v0.10) |
| PUT | `/api/budgets/{category_id}` | 지출 분류의 예산 정하기·바꾸기 (v0.10) |
| DELETE | `/api/budgets/{category_id}` | 예산 해제 (v0.10) |
| GET | `/api/recurring` | 고정 거래 목록 (v0.11) |
| POST | `/api/recurring` | 고정 거래 추가 (v0.11) |
| PUT | `/api/recurring/{id}` | 고정 거래 수정 (v0.11) |
| DELETE | `/api/recurring/{id}` | 고정 거래 삭제 (v0.11) |
| POST | `/api/recurring/apply` | 선택한 달에 고정 거래 불러오기 (v0.11) |

### 1.2 에러 형식

모든 에러 응답은 다음 형식으로 통일한다.

```json
{
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "금액은 1 이상의 정수여야 합니다."
  }
}
```

- `code`: 프로그램이 구분하는 데 쓰는 고정 문자열(대문자 + 밑줄)
- `message`: 화면에 그대로 보여 줄 수 있는 한국어 설명
- 입력값 문제가 여러 개면 **첫 번째 문제 하나만** 돌려준다. 검사 순서는 거래가 `date` → `type` → `amount` → `category` → `memo`, 분류가 `type` → `name`이다.

### 1.3 에러 코드 목록

| code | 상태 코드 | 상황 |
|---|---|---|
| `INVALID_JSON` | 400 | 요청 본문이 올바른 JSON 객체가 아님 |
| `MISSING_FIELD` | 422 | 필수 필드(거래: `date`, `type`, `amount`, `category` / 분류: `type`, `name`)가 없거나 `null` |
| `INVALID_DATE` | 422 | `date`가 `YYYY-MM-DD` 형식이 아니거나 존재하지 않는 날짜 |
| `INVALID_TYPE` | 422 | `type`이 `income`, `expense`가 아님 |
| `INVALID_AMOUNT` | 422 | `amount`가 정수가 아니거나(소수, 문자열, 불리언) 1 미만이거나 허용 최대값 초과 |
| `INVALID_CATEGORY` | 422 | `category`가 `type`에 해당하는 분류가 아님 (v0.4부터: 등록된 기본·사용자 분류 기준) |
| `INVALID_MEMO` | 422 | `memo`가 문자열이나 `null`이 아님 |
| `INVALID_QUERY` | 422 | `year`, `month` 쿼리가 없거나 범위를 벗어남, 분류 필터·검색어 쿼리가 잘못됨 |
| `INVALID_ID` | 422 | 경로의 `id`가 1 ~ 9,223,372,036,854,775,807(SQLite 정수 최대값) 범위의 정수가 아님 |
| `TRANSACTION_NOT_FOUND` | 404 | 해당 `id`의 거래가 없음 |
| `INVALID_CATEGORY_NAME` | 422 | (v0.4) 분류 `name`이 문자열이 아니거나, 앞뒤 공백 제거 후 비어 있거나 20자를 넘음 |
| `CATEGORY_NOT_FOUND` | 404 | (v0.4) 해당 `id`의 분류가 없음 |
| `DUPLICATE_CATEGORY` | 409 | (v0.4) 같은 유형에 같은 이름의 분류가 이미 있음 (기본 분류 포함) |
| `DEFAULT_CATEGORY_LOCKED` | 409 | (v0.4) 기본 분류를 수정하거나 삭제하려 함 |
| `CATEGORY_IN_USE` | 409 | (v0.4) 삭제하려는 분류를 사용하는 거래가 있음 (v0.11부터 고정 거래 포함) |
| `INVALID_BUDGET_CATEGORY` | 422 | (v0.10) 수입 분류에 예산을 정하려 함 |
| `BUDGET_NOT_FOUND` | 404 | (v0.10) 예산이 없는 분류의 예산을 해제하려 함 |
| `INVALID_DAY` | 422 | (v0.11) 고정 거래의 `day`가 1~31 정수가 아님 |
| `RECURRING_NOT_FOUND` | 404 | (v0.11) 해당 `id`의 고정 거래가 없음 |
| `NOT_FOUND` | 404 | 존재하지 않는 API 경로 |
| `METHOD_NOT_ALLOWED` | 405 | 경로는 있지만 지원하지 않는 메서드 (예: `GET /api/transactions/1`, `PATCH /api/categories`) |
| `DATABASE_ERROR` | 500 | `budget.db` 읽기·쓰기 실패 |
| `INTERNAL_ERROR` | 500 | 그 밖의 예상하지 못한 서버 오류 |

- 500 에러는 서버 로그에 원인을 기록하고, 응답 `message`에는 내부 정보(SQL, 파일 경로 등)를 넣지 않는다.

## 2. 데이터 형식

### 2.1 거래 내역 (`Transaction`)

```json
{
  "id": 7,
  "date": "2026-10-30",
  "type": "expense",
  "amount": 12500,
  "category": "식비",
  "memo": "점심",
  "created_at": "2026-10-30T12:34:56.123456"
}
```

### 2.2 등록·수정 요청 본문 (`TransactionInput`)

| 필드 | 필수 | 규칙 |
|---|---|---|
| `date` | O | `YYYY-MM-DD`, 실제 존재하는 날짜 |
| `type` | O | `income` 또는 `expense` |
| `amount` | O | 정수, 1 이상, 9,007,199,254,740,991 이하 |
| `category` | O | `type`에 해당하는 분류 이름 문자열 (v0.4부터 사용자 분류 포함) |
| `memo` | X | 문자열 또는 `null`. 앞뒤 공백을 제거한 뒤 빈 문자열이면 `null`로 저장 |

- `id`, `created_at`을 보내도 무시한다.
- 위에 없는 필드는 무시한다.
- `amount` 최대값은 브라우저 JavaScript가 정확히 다룰 수 있는 가장 큰 정수(`Number.MAX_SAFE_INTEGER`)다.

## 3. 엔드포인트

### 3.1 `GET /api/categories` — 분류 목록 조회

입력 폼의 분류 선택 목록과 분류 관리 카드를 채울 때 사용한다.

**요청**

```
GET /api/categories
```

**응답 `200 OK`** (v0.4)

순서: 기본 분류가 먼저(정해진 순서), 그다음 사용자 분류가 추가한 순서

```json
{
  "expense": [
    { "id": 1, "type": "expense", "name": "식비", "is_default": true },
    { "id": 2, "type": "expense", "name": "교통", "is_default": true },
    { "id": 3, "type": "expense", "name": "주거", "is_default": true },
    { "id": 4, "type": "expense", "name": "쇼핑", "is_default": true },
    { "id": 5, "type": "expense", "name": "의료", "is_default": true },
    { "id": 6, "type": "expense", "name": "문화·여가", "is_default": true },
    { "id": 7, "type": "expense", "name": "기타", "is_default": true },
    { "id": 11, "type": "expense", "name": "간식", "is_default": false }
  ],
  "income": [
    { "id": 8, "type": "income", "name": "월급", "is_default": true },
    { "id": 9, "type": "income", "name": "용돈", "is_default": true },
    { "id": 10, "type": "income", "name": "기타", "is_default": true }
  ]
}
```

- MVP(v0.1 ~ v0.3)의 응답은 이름 배열(`{"expense": ["식비", ...], "income": [...]}`)이었다.

**에러**

| 상황 | 상태 코드 | code |
|---|---|---|
| DB 읽기 실패 | 500 | `DATABASE_ERROR` |

---

### 3.2 `GET /api/transactions` — 월별 거래 목록 조회

선택한 연·월의 거래를 정렬해서 돌려준다.

**쿼리 파라미터**

| 이름 | 필수 | 규칙 |
|---|---|---|
| `year` | O | 정수, 1 ~ 9999 |
| `month` | O | 정수, 1 ~ 12 |
| `type` | X | (v0.6 분류 필터) `income` 또는 `expense`. `category`와 함께 보내야 함 |
| `category` | X | (v0.6 분류 필터) 분류 이름. `type`과 함께 보내야 함 |
| `q` | X | (v0.9 검색어) 메모 검색어. 앞뒤 공백 제거 후 1~50자, 빈 값이면 무시 |

- `type`과 `category`를 보내면 그 유형·분류의 거래만 돌려준다. 정렬은 같다. 없는 분류 이름이면 빈 배열이다.
- (v0.9) `type`만 보내면 그 유형의 거래만 돌려준다. `category`는 여전히 `type`이 있어야 한다.
- (v0.9) `q`를 보내면 메모에 그 글자가 들어 있는 거래만 돌려준다. 영문 대소문자는 구분하지 않고, `%`·`_`도 일반 글자로 찾는다. 메모가 없는 거래는 제외한다.
- (v0.9) 모든 조건은 함께(AND) 적용한다. 예: `?year=2026&month=10&type=expense&q=점심`
- 예: `GET /api/transactions?year=2026&month=10&type=expense&category=식비`

**요청**

```
GET /api/transactions?year=2026&month=10
```

**응답 `200 OK`**

정렬: `date` 내림차순 → `created_at` 내림차순 → `id` 내림차순

```json
[
  {
    "id": 8,
    "date": "2026-10-30",
    "type": "income",
    "amount": 3000000,
    "category": "월급",
    "memo": null,
    "created_at": "2026-10-30T18:00:00.000000"
  },
  {
    "id": 7,
    "date": "2026-10-30",
    "type": "expense",
    "amount": 12500,
    "category": "식비",
    "memo": "점심",
    "created_at": "2026-10-30T12:34:56.123456"
  }
]
```

**응답 `200 OK` — 해당 월에 내역이 없을 때**

```json
[]
```

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `year` 또는 `month` 없음 | 422 | `INVALID_QUERY` | `조회할 연도와 월을 입력해 주세요.` |
| `month`가 13, `1.5` 등 | 422 | `INVALID_QUERY` | `월은 1부터 12 사이여야 합니다.` |
| `year`가 0, `abc` 등 | 422 | `INVALID_QUERY` | `연도는 1부터 9999 사이여야 합니다.` |
| (v0.6) `type`·`category` 중 하나만 있음 (빈 문자열 포함) | 422 | `INVALID_QUERY` | `분류 필터는 유형과 분류를 함께 지정해야 합니다.` (v0.9부터는 `category`만 있을 때만 해당, `type`만 있으면 정상) |
| (v0.9) `q`가 앞뒤 공백 제거 후 50자 초과 | 422 | `INVALID_QUERY` | `검색어는 50자 이하여야 합니다.` |
| (v0.6) `type`이 `income`·`expense`가 아님 | 422 | `INVALID_QUERY` | `분류 필터의 유형이 올바르지 않습니다.` |
| DB 읽기 실패 | 500 | `DATABASE_ERROR` | `거래 내역을 불러오지 못했습니다.` |

---

### 3.3 `POST /api/transactions` — 거래 등록

**요청**

```
POST /api/transactions
Content-Type: application/json
```

```json
{
  "date": "2026-10-30",
  "type": "expense",
  "amount": 12500,
  "category": "식비",
  "memo": "점심"
}
```

메모 없이 등록하는 경우:

```json
{
  "date": "2026-10-30",
  "type": "income",
  "amount": 3000000,
  "category": "월급"
}
```

**응답 `201 Created`**

```json
{
  "id": 7,
  "date": "2026-10-30",
  "type": "expense",
  "amount": 12500,
  "category": "식비",
  "memo": "점심",
  "created_at": "2026-10-30T12:34:56.123456"
}
```

**에러**

| 상황 | 요청 예시 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|---|
| JSON이 깨짐 | `{"date": "2026-10-30",` | 400 | `INVALID_JSON` | `요청 형식이 올바르지 않습니다.` |
| 필수값 없음 | `amount` 생략 | 422 | `MISSING_FIELD` | `금액을 입력해 주세요.` |
| 없는 날짜 | `"date": "2026-02-30"` | 422 | `INVALID_DATE` | `거래일이 올바른 날짜가 아닙니다.` |
| 잘못된 유형 | `"type": "transfer"` | 422 | `INVALID_TYPE` | `거래 유형은 수입 또는 지출이어야 합니다.` |
| 금액이 0 이하 | `"amount": 0` | 422 | `INVALID_AMOUNT` | `금액은 1 이상의 정수여야 합니다.` |
| 금액이 소수 | `"amount": 12.5` | 422 | `INVALID_AMOUNT` | `금액은 1 이상의 정수여야 합니다.` |
| 금액이 문자열 | `"amount": "12500"` | 422 | `INVALID_AMOUNT` | `금액은 1 이상의 정수여야 합니다.` |
| 유형과 분류 불일치 | `"type": "income", "category": "식비"` | 422 | `INVALID_CATEGORY` | `수입에는 '식비' 분류를 사용할 수 없습니다.` |
| 메모가 문자열이 아님 | `"memo": 123` | 422 | `INVALID_MEMO` | `메모는 문자열이어야 합니다.` |
| DB 쓰기 실패 | — | 500 | `DATABASE_ERROR` | `거래 내역을 저장하지 못했습니다.` |

에러 응답 예시:

```json
{
  "error": {
    "code": "INVALID_CATEGORY",
    "message": "수입에는 '식비' 분류를 사용할 수 없습니다."
  }
}
```

- 에러가 나면 DB에 아무것도 저장하지 않는다.

---

### 3.4 `PUT /api/transactions/{id}` — 거래 수정

수정 가능한 5개 필드를 한 번에 모두 보낸다. 생략한 `memo`는 `null`로 저장한다. `id`, `created_at`은 바뀌지 않는다.

**요청**

```
PUT /api/transactions/7
Content-Type: application/json
```

```json
{
  "date": "2026-11-02",
  "type": "expense",
  "amount": 15000,
  "category": "식비",
  "memo": "저녁"
}
```

**응답 `200 OK`**

```json
{
  "id": 7,
  "date": "2026-11-02",
  "type": "expense",
  "amount": 15000,
  "category": "식비",
  "memo": "저녁",
  "created_at": "2026-10-30T12:34:56.123456"
}
```

- 거래일을 다른 달로 바꾼 경우, 화면은 이전 달과 새 달의 요약을 모두 다시 조회해야 한다.

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `id`가 `abc`, `0`, `-1`, `9223372036854775808` | 422 | `INVALID_ID` | `거래 ID가 올바르지 않습니다.` |
| 해당 `id` 거래 없음 | 404 | `TRANSACTION_NOT_FOUND` | `이미 삭제되었거나 없는 내역입니다.` |
| 본문 검증 실패 | 400 / 422 | `POST`와 동일 | `POST`와 동일 |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `거래 내역을 수정하지 못했습니다.` |

- `id` 검사 → 본문 검사 → 거래 존재 확인 순서로 처리한다.
- 에러가 나면 기존 거래는 바뀌지 않는다.

---

### 3.5 `DELETE /api/transactions/{id}` — 거래 삭제

화면에서 확인 창을 거친 뒤에만 호출한다. 삭제한 거래는 복구할 수 없다.

**요청**

```
DELETE /api/transactions/7
```

**응답 `204 No Content`**

본문 없음.

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `id`가 `abc`, `0`, `-1`, `9223372036854775808` | 422 | `INVALID_ID` | `거래 ID가 올바르지 않습니다.` |
| 해당 `id` 거래 없음 | 404 | `TRANSACTION_NOT_FOUND` | `이미 삭제되었거나 없는 내역입니다.` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `거래 내역을 삭제하지 못했습니다.` |

```json
{
  "error": {
    "code": "TRANSACTION_NOT_FOUND",
    "message": "이미 삭제되었거나 없는 내역입니다."
  }
}
```

---

### 3.6 `GET /api/summary` — 월별 요약 조회

**쿼리 파라미터**

`GET /api/transactions`와 같다. (`year` 1 ~ 9999, `month` 1 ~ 12, 모두 필수 / v0.6: 선택 `type`·`category`)

- (v0.6) `type`과 `category`를 보내면 그 분류의 거래만으로 합계를 계산한다. 예: 지출 `식비`로 거르면 `income`은 0, `balance`는 `-expense`다.
- (v0.9) `type` 단독, `q`도 `GET /api/transactions`와 같은 규칙으로 받아, 걸러진 거래만으로 합계를 계산한다.

**요청**

```
GET /api/summary?year=2026&month=10
```

**응답 `200 OK`**

```json
{
  "year": 2026,
  "month": 10,
  "income": 3000000,
  "expense": 12500,
  "balance": 2987500
}
```

**응답 `200 OK` — 해당 월에 내역이 없을 때**

```json
{
  "year": 2026,
  "month": 9,
  "income": 0,
  "expense": 0,
  "balance": 0
}
```

- `balance` = `income` - `expense`이며 음수일 수 있다.
- 다른 달의 거래는 포함하지 않는다.

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `year` 또는 `month` 없음 | 422 | `INVALID_QUERY` | `조회할 연도와 월을 입력해 주세요.` |
| `month`가 범위 밖·정수 아님 | 422 | `INVALID_QUERY` | `월은 1부터 12 사이여야 합니다.` |
| `year`가 범위 밖·정수 아님 | 422 | `INVALID_QUERY` | `연도는 1부터 9999 사이여야 합니다.` |
| (v0.6) 분류 필터 오류 | 422 | `INVALID_QUERY` | `GET /api/transactions`와 같음 |
| DB 읽기 실패 | 500 | `DATABASE_ERROR` | `월별 요약을 불러오지 못했습니다.` |

---

### 3.7 `POST /api/categories` — 분류 추가 (v0.4)

**요청 본문**

| 필드 | 필수 | 규칙 |
|---|---|---|
| `type` | O | `income` 또는 `expense` |
| `name` | O | 문자열. 앞뒤 공백을 제거한 뒤 1~20자. 같은 `type` 안에서 기존 분류(기본 분류 포함)와 겹치지 않음 |

- `id`, `is_default` 등 위에 없는 필드는 무시한다. 추가한 분류는 항상 `is_default: false`다.

```
POST /api/categories
Content-Type: application/json
```

```json
{ "type": "expense", "name": "  간식  " }
```

**응답 `201 Created`**

```json
{ "id": 11, "type": "expense", "name": "간식", "is_default": false }
```

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| JSON이 깨짐 | 400 | `INVALID_JSON` | `요청 형식이 올바르지 않습니다.` |
| `type` 없음 | 422 | `MISSING_FIELD` | `거래 유형을 선택해 주세요.` |
| `name` 없음 | 422 | `MISSING_FIELD` | `분류 이름을 입력해 주세요.` |
| 잘못된 유형 | 422 | `INVALID_TYPE` | `거래 유형은 수입 또는 지출이어야 합니다.` |
| 빈 이름 (`""`, `"   "`) | 422 | `INVALID_CATEGORY_NAME` | `분류 이름을 입력해 주세요.` |
| 20자 초과 | 422 | `INVALID_CATEGORY_NAME` | `분류 이름은 20자 이하여야 합니다.` |
| 문자열 아님 (`123`) | 422 | `INVALID_CATEGORY_NAME` | `분류 이름은 문자열이어야 합니다.` |
| 같은 유형에 같은 이름 있음 | 409 | `DUPLICATE_CATEGORY` | `지출에 이미 '식비' 분류가 있습니다.` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `분류를 저장하지 못했습니다.` |

- 에러가 나면 분류를 저장하지 않는다.

---

### 3.8 `PUT /api/categories/{id}` — 사용자 분류 이름 수정 (v0.4)

이름만 바꿀 수 있다. 본문에 `type`이 있어도 무시한다. 이름을 바꾸면 같은 트랜잭션에서 그 분류를 쓰던 거래(같은 `type`, 옛 이름)의 `category`도 새 이름으로 바뀐다.

**요청**

```
PUT /api/categories/11
Content-Type: application/json
```

```json
{ "name": "커피·간식" }
```

**응답 `200 OK`**

```json
{ "id": 11, "type": "expense", "name": "커피·간식", "is_default": false }
```

- 지금 이름과 같은 이름으로 수정하면 아무것도 바뀌지 않고 200을 돌려준다.

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `id`가 `abc`, `0`, `-1` 등 | 422 | `INVALID_ID` | `분류 ID가 올바르지 않습니다.` |
| 본문 검증 실패 (`name` 없음·빈 이름·20자 초과·문자열 아님, 깨진 JSON) | 400 / 422 | `POST /api/categories`와 같음 | `POST /api/categories`와 같음 |
| 해당 `id` 분류 없음 | 404 | `CATEGORY_NOT_FOUND` | `이미 삭제되었거나 없는 분류입니다.` |
| 기본 분류 | 409 | `DEFAULT_CATEGORY_LOCKED` | `기본 분류는 수정하거나 삭제할 수 없습니다.` |
| 같은 유형에 같은 이름 있음 | 409 | `DUPLICATE_CATEGORY` | `지출에 이미 '식비' 분류가 있습니다.` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `분류를 수정하지 못했습니다.` |

- 처리 순서: `id` 검사 → 본문 검사 → 분류 존재 확인 → 기본 분류 확인 → 이름 중복 확인
- 에러가 나면 분류와 거래 모두 바뀌지 않는다.

---

### 3.9 `DELETE /api/categories/{id}` — 사용자 분류 삭제 (v0.4)

화면에서 확인 창을 거친 뒤에만 호출한다.

**요청**

```
DELETE /api/categories/11
```

**응답 `204 No Content`**

본문 없음.

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `id`가 `abc`, `0`, `-1` 등 | 422 | `INVALID_ID` | `분류 ID가 올바르지 않습니다.` |
| 해당 `id` 분류 없음 | 404 | `CATEGORY_NOT_FOUND` | `이미 삭제되었거나 없는 분류입니다.` |
| 기본 분류 | 409 | `DEFAULT_CATEGORY_LOCKED` | `기본 분류는 수정하거나 삭제할 수 없습니다.` |
| 이 분류를 쓰는 거래가 있음 | 409 | `CATEGORY_IN_USE` | `이 분류를 사용하는 거래가 3건 있어 삭제할 수 없습니다.` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `분류를 삭제하지 못했습니다.` |

- 거래 사용 여부는 같은 `type`의 거래만 센다. 예: 수입 `부업` 거래가 있어도 지출 `부업` 분류는 삭제할 수 있다.

---

### 3.10 `GET /api/backup` — 데이터베이스 백업 다운로드 (v0.5)

서버의 `budget.db` 전체(거래 내역, 분류)를 SQLite 파일로 내려준다. 서버가 실행 중이어도 SQLite 백업 기능으로 깨지지 않은 복사본을 만든다. DB를 읽기만 하며 데이터를 바꾸지 않는다.

**요청**

```
GET /api/backup
```

**응답 `200 OK`**

```
Content-Type: application/vnd.sqlite3
Content-Disposition: attachment; filename="budget-backup-2026-10-30-1530.db"

(SQLite 파일 바이트)
```

- 파일 이름: `budget-backup-YYYY-MM-DD-HHMM.db` (서버의 현재 날짜와 시각, 24시간제)
- 받은 파일은 이름을 `budget.db`로 바꿔 그대로 사용할 수 있다. (수동 복원 방법은 README)

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| DB 읽기 실패 | 500 | `DATABASE_ERROR` | `백업 파일을 만들지 못했습니다.` |
| `GET` 외의 메서드 | 405 | `METHOD_NOT_ALLOWED` | `지원하지 않는 요청 방식입니다.` |

---

### 3.11 `GET /api/summary/categories` — 분류별 지출 합계 (v0.8, 구현 전)

선택한 달의 지출을 분류별로 합친다. 수입은 포함하지 않는다. 거래 목록의 필터 쿼리는 받지 않는다(항상 그 달 전체).

**쿼리:** `year`(1~9999), `month`(1~12) 필수

```
GET /api/summary/categories?year=2026&month=10
```

**응답 `200 OK`**

정렬: `amount` 내림차순 → `category` 오름차순

```json
{
  "year": 2026,
  "month": 10,
  "total": 575000,
  "items": [
    { "category": "주거", "amount": 550000, "count": 1, "budget": null, "remaining": null },
    { "category": "식비", "amount": 20500, "count": 2, "budget": 300000, "remaining": 279500 },
    { "category": "간식", "amount": 4500, "count": 1, "budget": null, "remaining": null }
  ]
}
```

- `total`은 그 달 지출 합계이며 `GET /api/summary`의 `expense`와 같다. 지출이 없으면 `total` 0, `items` `[]`.
- `budget`, `remaining`은 v0.10부터 들어간다. v0.8에서는 항상 `null`이다.
- (v0.10) 예산이 있는 지출 분류는 그 달 지출이 없어도 `amount` 0, `count` 0으로 들어간다. `remaining` = `budget` - `amount` (음수면 초과).

**에러**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `year`·`month` 없음·범위 밖 | 422 | `INVALID_QUERY` | `GET /api/summary`와 같음 |
| DB 읽기 실패 | 500 | `DATABASE_ERROR` | `분류별 지출을 불러오지 못했습니다.` |

---

### 3.12 `GET /api/budgets` — 예산 목록 (v0.10, 구현 전)

**응답 `200 OK`** (분류 목록 순서와 같음)

```json
[
  { "category_id": 1, "category": "식비", "amount": 300000 },
  { "category_id": 11, "category": "간식", "amount": 50000 }
]
```

| 상황 | 상태 코드 | code |
|---|---|---|
| DB 읽기 실패 | 500 | `DATABASE_ERROR` |

---

### 3.13 `PUT /api/budgets/{category_id}` — 예산 정하기·바꾸기 (v0.10, 구현 전)

없으면 새로 만들고, 있으면 금액을 바꾼다.

```json
{ "amount": 300000 }
```

**응답 `200 OK`**

```json
{ "category_id": 1, "category": "식비", "amount": 300000 }
```

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `category_id` 형식 오류 | 422 | `INVALID_ID` | `분류 ID가 올바르지 않습니다.` |
| `amount` 없음 | 422 | `MISSING_FIELD` | `금액을 입력해 주세요.` |
| `amount`가 정수 아님·1 미만·최대값 초과 | 422 | `INVALID_AMOUNT` | `금액은 1 이상의 정수여야 합니다.` |
| 없는 분류 | 404 | `CATEGORY_NOT_FOUND` | `이미 삭제되었거나 없는 분류입니다.` |
| 수입 분류 | 422 | `INVALID_BUDGET_CATEGORY` | `수입 분류에는 예산을 정할 수 없습니다.` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `예산을 저장하지 못했습니다.` |

- 처리 순서: `id` 검사 → 본문 검사 → 분류 존재 확인 → 지출 분류 확인

---

### 3.14 `DELETE /api/budgets/{category_id}` — 예산 해제 (v0.10, 구현 전)

**응답 `204 No Content`**

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| `category_id` 형식 오류 | 422 | `INVALID_ID` | `분류 ID가 올바르지 않습니다.` |
| 예산이 없음 (없는 분류 포함) | 404 | `BUDGET_NOT_FOUND` | `예산이 정해지지 않은 분류입니다.` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `예산을 해제하지 못했습니다.` |

- (v0.10) `DELETE /api/categories/{id}`로 분류를 삭제하면 그 분류의 예산도 같은 트랜잭션에서 지운다.

---

### 3.15 `GET /api/recurring` — 고정 거래 목록 (v0.11, 구현 전)

**쿼리:** `year`, `month` (선택, 함께 보내야 함). 보내면 각 항목에 그 달에 이미 불러왔는지(`applied`)를 넣는다.

```
GET /api/recurring?year=2026&month=10
```

**응답 `200 OK`** (정렬: `day` → 등록 순)

```json
[
  { "id": 1, "day": 1, "type": "expense", "amount": 550000, "category_id": 3, "category": "주거", "memo": "월세", "applied": true },
  { "id": 2, "day": 25, "type": "income", "amount": 3000000, "category_id": 8, "category": "월급", "memo": null, "applied": false }
]
```

- `year`·`month`를 보내지 않으면 `applied`는 `null`이다.

| 상황 | 상태 코드 | code |
|---|---|---|
| `year`·`month` 중 하나만 있음·범위 밖 | 422 | `INVALID_QUERY` |
| DB 읽기 실패 | 500 | `DATABASE_ERROR` |

---

### 3.16 `POST /api/recurring` — 고정 거래 추가 (v0.11, 구현 전)

| 필드 | 필수 | 규칙 |
|---|---|---|
| `day` | O | 정수 1~31 |
| `type` | O | `income` 또는 `expense` |
| `amount` | O | 거래 `amount`와 같은 규칙 |
| `category_id` | O | 있는 분류의 `id`이며 `type`과 유형이 같아야 함 |
| `memo` | X | 거래 `memo`와 같은 규칙 |

```json
{ "day": 1, "type": "expense", "amount": 550000, "category_id": 3, "memo": "월세" }
```

**응답 `201 Created`:** 3.15의 항목 1개 (`applied`는 `null`)

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| JSON 오류 | 400 | `INVALID_JSON` | `요청 형식이 올바르지 않습니다.` |
| 필수값 누락 | 422 | `MISSING_FIELD` | `날을 입력해 주세요.` 등 |
| `day` 오류 | 422 | `INVALID_DAY` | `날은 1부터 31 사이여야 합니다.` |
| `type`·`amount`·`memo` 오류 | 422 | 거래와 같은 코드 | 거래와 같음 |
| 없는 분류 / 유형이 다른 분류 | 422 | `INVALID_CATEGORY` | `분류를 찾을 수 없습니다.` / `지출에는 '월급' 분류를 사용할 수 없습니다.` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `고정 거래를 저장하지 못했습니다.` |

- 검사 순서: `day` → `type` → `amount` → `category_id` → `memo`

---

### 3.17 `PUT /api/recurring/{id}` — 고정 거래 수정 (v0.11, 구현 전)

본문과 검사 규칙은 3.16과 같다. 이미 불러온 거래는 바뀌지 않는다.

**응답 `200 OK`:** 수정된 항목

| 상황 | 상태 코드 | code |
|---|---|---|
| `id` 형식 오류 | 422 | `INVALID_ID` |
| 본문 오류 | 400 / 422 | 3.16과 같음 |
| 없는 고정 거래 | 404 | `RECURRING_NOT_FOUND` (`이미 삭제되었거나 없는 고정 거래입니다.`) |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` |

---

### 3.18 `DELETE /api/recurring/{id}` — 고정 거래 삭제 (v0.11, 구현 전)

**응답 `204 No Content`.** 그 틀의 불러온 기록도 함께 지운다. 이미 불러온 거래는 그대로 둔다.

| 상황 | 상태 코드 | code |
|---|---|---|
| `id` 형식 오류 | 422 | `INVALID_ID` |
| 없는 고정 거래 | 404 | `RECURRING_NOT_FOUND` |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` |

---

### 3.19 `POST /api/recurring/apply` — 선택한 달에 고정 거래 불러오기 (v0.11, 구현 전)

그 달에 아직 불러오지 않은 고정 거래를 모두 거래로 추가하고 불러온 기록을 남긴다. 한 트랜잭션이다.

```json
{ "year": 2026, "month": 2 }
```

**응답 `200 OK`**

```json
{
  "year": 2026,
  "month": 2,
  "created": [
    { "id": 31, "date": "2026-02-28", "type": "expense", "amount": 120000, "category": "주거", "memo": "관리비 (31일 고정 거래)", "created_at": "2026-10-30T12:00:00.000000" }
  ],
  "skipped": 1
}
```

- `created`: 이번에 추가된 거래 (거래 응답 형식). 날짜는 `min(day, 그 달 말일)`이다. 예: `day` 31 → 2026년 2월 28일
- `skipped`: 이미 그 달에 불러와서 건너뛴 고정 거래 수
- 불러올 것이 없으면 `created` `[]`로 200을 돌려준다.

| 상황 | 상태 코드 | code | 응답 예시 `message` |
|---|---|---|---|
| JSON 오류 | 400 | `INVALID_JSON` | `요청 형식이 올바르지 않습니다.` |
| `year`·`month` 없음·범위 밖 | 422 | `INVALID_QUERY` | `GET /api/summary`와 같음 |
| DB 쓰기 실패 | 500 | `DATABASE_ERROR` | `고정 거래를 불러오지 못했습니다.` (아무것도 추가되지 않음) |

- (v0.11) `DELETE /api/categories/{id}`의 `CATEGORY_IN_USE` 검사에 고정 거래를 더한다. 메시지 예: `이 분류를 사용하는 거래 2건, 고정 거래 1건이 있어 삭제할 수 없습니다.` (고정 거래가 없으면 v0.4 메시지 그대로)

## 4. 구현 참고

- FastAPI는 기본적으로 `{"detail": ...}` 형식으로 에러를 돌려준다. 1.2절 형식으로 통일하려면 다음 예외 처리기를 등록한다.
  - `RequestValidationError` → 400 `INVALID_JSON` 또는 422 각 코드로 변환
  - `HTTPException`(404, 405 등) → `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `TRANSACTION_NOT_FOUND`
  - `sqlite3.Error` → 500 `DATABASE_ERROR`
  - 그 밖의 `Exception` → 500 `INTERNAL_ERROR`
- FastAPI가 자동으로 만드는 `/docs` 화면의 에러 예시는 기본 형식으로 보일 수 있다. 실제 응답은 이 문서를 따른다.
