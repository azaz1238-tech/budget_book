# API 명세 초안 - 개인 가계부

> 기준 문서: `docs/DATA_MODEL.md` (보조: `docs/PRD.md`, `docs/SPEC.md`, `docs/TRD.md`)
> 대상 범위: MVP(v0.1 ~ v0.3)

## 1. 공통 규칙

- 기본 주소: `http://127.0.0.1:8000`
- 모든 API 경로는 `/api`로 시작한다.
- 요청·응답 본문은 JSON(`Content-Type: application/json`, UTF-8)이다.
- 인증은 없다.
- 날짜는 `YYYY-MM-DD`, 시각은 ISO 8601(`2026-10-30T12:34:56.123456`) 문자열이다.
- 금액은 원 단위 정수다.

### 1.1 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/categories` | 고정 분류 목록 조회 |
| GET | `/api/transactions` | 월별 거래 목록 조회 |
| POST | `/api/transactions` | 거래 등록 |
| PUT | `/api/transactions/{id}` | 거래 수정 |
| DELETE | `/api/transactions/{id}` | 거래 삭제 |
| GET | `/api/summary` | 월별 요약 조회 |

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
- 입력값 문제가 여러 개면 **첫 번째 문제 하나만** 돌려준다. 검사 순서는 `date` → `type` → `amount` → `category` → `memo`다.

### 1.3 에러 코드 목록

| code | 상태 코드 | 상황 |
|---|---|---|
| `INVALID_JSON` | 400 | 요청 본문이 올바른 JSON 객체가 아님 |
| `MISSING_FIELD` | 422 | 필수 필드(`date`, `type`, `amount`, `category`)가 없거나 `null` |
| `INVALID_DATE` | 422 | `date`가 `YYYY-MM-DD` 형식이 아니거나 존재하지 않는 날짜 |
| `INVALID_TYPE` | 422 | `type`이 `income`, `expense`가 아님 |
| `INVALID_AMOUNT` | 422 | `amount`가 정수가 아니거나(소수, 문자열, 불리언) 1 미만이거나 허용 최대값 초과 |
| `INVALID_CATEGORY` | 422 | `category`가 `type`에 해당하는 고정 분류가 아님 |
| `INVALID_MEMO` | 422 | `memo`가 문자열이나 `null`이 아님 |
| `INVALID_QUERY` | 422 | `year`, `month` 쿼리가 없거나 범위를 벗어남 |
| `INVALID_ID` | 422 | 경로의 `id`가 1 이상의 정수가 아님 |
| `TRANSACTION_NOT_FOUND` | 404 | 해당 `id`의 거래가 없음 |
| `NOT_FOUND` | 404 | 존재하지 않는 API 경로 |
| `METHOD_NOT_ALLOWED` | 405 | 경로는 있지만 지원하지 않는 메서드 |
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
| `category` | O | `type`에 해당하는 고정 분류 문자열 |
| `memo` | X | 문자열 또는 `null`. 앞뒤 공백을 제거한 뒤 빈 문자열이면 `null`로 저장 |

- `id`, `created_at`을 보내도 무시한다.
- 위에 없는 필드는 무시한다.
- `amount` 최대값은 브라우저 JavaScript가 정확히 다룰 수 있는 가장 큰 정수(`Number.MAX_SAFE_INTEGER`)다.

## 3. 엔드포인트

### 3.1 `GET /api/categories` — 고정 분류 목록 조회

입력 폼의 분류 선택 목록을 채울 때 사용한다.

**요청**

```
GET /api/categories
```

**응답 `200 OK`**

```json
{
  "expense": ["식비", "교통", "주거", "쇼핑", "의료", "문화·여가", "기타"],
  "income": ["월급", "용돈", "기타"]
}
```

**에러**

| 상황 | 상태 코드 | code |
|---|---|---|
| 예상하지 못한 서버 오류 | 500 | `INTERNAL_ERROR` |

---

### 3.2 `GET /api/transactions` — 월별 거래 목록 조회

선택한 연·월의 거래를 정렬해서 돌려준다.

**쿼리 파라미터**

| 이름 | 필수 | 규칙 |
|---|---|---|
| `year` | O | 정수, 1 ~ 9999 |
| `month` | O | 정수, 1 ~ 12 |

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
| `month`가 13, `year`가 `abc` 등 | 422 | `INVALID_QUERY` | `월은 1부터 12 사이여야 합니다.` |
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
| `id`가 `abc`, `0`, `-1` | 422 | `INVALID_ID` | `거래 ID가 올바르지 않습니다.` |
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
| `id`가 `abc`, `0`, `-1` | 422 | `INVALID_ID` | `거래 ID가 올바르지 않습니다.` |
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

`GET /api/transactions`와 같다. (`year` 1 ~ 9999, `month` 1 ~ 12, 모두 필수)

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
| `year` 또는 `month` 없음·범위 밖 | 422 | `INVALID_QUERY` | `월은 1부터 12 사이여야 합니다.` |
| DB 읽기 실패 | 500 | `DATABASE_ERROR` | `월별 요약을 불러오지 못했습니다.` |

## 4. 구현 참고

- FastAPI는 기본적으로 `{"detail": ...}` 형식으로 에러를 돌려준다. 1.2절 형식으로 통일하려면 다음 예외 처리기를 등록한다.
  - `RequestValidationError` → 400 `INVALID_JSON` 또는 422 각 코드로 변환
  - `HTTPException`(404, 405 등) → `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `TRANSACTION_NOT_FOUND`
  - `sqlite3.Error` → 500 `DATABASE_ERROR`
  - 그 밖의 `Exception` → 500 `INTERNAL_ERROR`
- FastAPI가 자동으로 만드는 `/docs` 화면의 에러 예시는 기본 형식으로 보일 수 있다. 실제 응답은 이 문서를 따른다.
