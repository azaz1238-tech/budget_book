# 테스트 케이스 초안 - 개인 가계부

> 기준 문서: `docs/PRD.md`, `docs/SPEC.md`, `docs/TRD.md`, `docs/DATA_MODEL.md`, `docs/API_SPEC.md`, `docs/COMPONENT_SPEC.md`
> 대상 범위: MVP(v0.1 ~ v0.3), v0.4 사용자 분류 편집(1.8 ~ 1.10절, 2.8절), v0.5 백업(1.11절, 2.9절)

## 0. 공통 사항

### 0.1 ID 규칙

- `API-<대상>-N01`: API 정상 케이스 / `API-<대상>-E01`: API 에러 케이스
- `CMP-<대상>-N01`: 컴포넌트 정상 케이스 / `CMP-<대상>-E01`: 컴포넌트 에러 케이스

### 0.2 실행 방식

| 구분 | 실행 방식 |
|---|---|
| API | pytest + FastAPI `TestClient`. 테스트마다 빈 임시 DB 파일(`BUDGET_DB_PATH`)을 사용하고 실제 `budget.db`는 건드리지 않는다. |
| 컴포넌트 | 서버를 실행한 뒤 브라우저에서 직접 확인한다. (현재 스택에 JavaScript 테스트 도구가 없음) |

- **DB 오류 상황**: 테스트에서 DB 연결 함수가 `sqlite3.OperationalError`를 일으키도록 바꿔서 만든다.
- **트랜잭션 중간 실패 상황** (v0.4): 테스트 DB에 `transactions` 수정 시 오류를 내는 트리거를 만들어, 분류 이름 수정 중 두 번째 `UPDATE`가 실패하게 한다.
- **서버 연결 실패 상황**: 화면을 연 뒤 서버를 종료해서 만든다.
- **정해진 시각**: 별도 표기가 없으면 "오늘"은 `2026-10-30`, 선택한 월은 `2026년 10월`로 가정한다.

### 0.3 공통 준비 데이터 (API)

필요한 테스트에서 아래 거래를 먼저 등록한다.

| 이름 | date | type | amount | category | memo |
|---|---|---|---|---|---|
| T1 | 2026-10-30 | expense | 12500 | 식비 | 점심 |
| T2 | 2026-10-30 | income | 3000000 | 월급 | (없음) |
| T3 | 2026-10-01 | expense | 50000 | 교통 | (없음) |
| T4 | 2026-09-30 | expense | 7000 | 쇼핑 | (없음) |
| T5 | 2026-11-01 | income | 100000 | 용돈 | (없음) |

---

## 1. API 테스트

### 1.1 공통

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-COM-N01 | `GET /` | 화면 주소 요청 | 200, `index.html` 반환 |
| API-COM-N02 | DB 초기화 | DB 파일이 없는 상태로 앱 시작 | `transactions`·`categories` 테이블과 `idx_transactions_date` 인덱스가 자동 생성되고, `categories`에 기본 분류 10개가 들어감 |
| API-COM-N03 | 데이터 유지 | T1 등록 후, 같은 DB 파일로 앱을 새로 만들어 목록 조회 | T1이 그대로 조회됨 (서버 재실행 후에도 유지) |
| API-COM-N04 | 응답 형식 | 본문이 있는 모든 성공 응답 | `Content-Type`이 `application/json` |
| API-COM-E01 | 없는 경로 | `GET /api/unknown` | 404, `NOT_FOUND` |
| API-COM-E02 | 지원하지 않는 메서드 | `PATCH /api/transactions/1`, `GET /api/transactions/1` | 각각 405, `METHOD_NOT_ALLOWED` |
| API-COM-E03 | 에러 형식 | 이 문서의 모든 에러 케이스 응답 | 본문이 `{ "error": { "code", "message" } }` 형식이고 `detail` 필드가 없음 |
| API-COM-E04 | 500 메시지 | `DATABASE_ERROR` 응답 | `message`에 SQL, 파일 경로, 예외 이름이 들어 있지 않음 |

### 1.2 `GET /api/categories`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-CAT-N01 | 분류 목록 | 요청 | 200, `expense` 이름이 `["식비","교통","주거","쇼핑","의료","문화·여가","기타"]`, `income` 이름이 `["월급","용돈","기타"]` (순서 포함 일치). 각 항목은 `id`, `type`, `name`, `is_default`(모두 `true`)를 가짐 |
| API-CAT-N02 | 기본 분류 유지 | 거래를 여러 건 등록·수정·삭제한 뒤 요청 | N01과 같은 목록 (변경되지 않음) |
| API-CAT-N03 | 정렬 | 지출 `간식`, `커피` 순서로 추가 후 요청 | `expense`가 기본 분류 7개 다음에 `간식`, `커피` 순서, 둘 다 `is_default: false` |
| API-CAT-N04 | 재시작 중복 없음 | 같은 DB 파일로 앱을 다시 만들어 요청 | 기본 분류가 여전히 10개 (중복 생성 안 됨), 추가한 사용자 분류도 유지 |
| API-CAT-N05 | MVP DB 이전 | `transactions`만 있는 MVP 시절 DB(거래 1건 포함)로 앱 시작 | `categories`가 생기고 기본 분류 10개가 들어감. 기존 거래가 그대로 조회됨 |
| API-CAT-E01 | 메서드 | `PATCH /api/categories` | 405, `METHOD_NOT_ALLOWED` |
| API-CAT-E02 | DB 오류 | DB 읽기 실패 | 500, `DATABASE_ERROR` |

### 1.3 `GET /api/transactions`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-LIST-N01 | 월 필터 | T1~T5 등록 후 `year=2026&month=10` | 200, T1·T2·T3만 반환 (T4·T5 제외) |
| API-LIST-N02 | 월 경계 | N01과 같음 | 10월 1일(T3)과 10월 30일(T1·T2)은 포함, 9월 30일(T4)과 11월 1일(T5)은 제외 |
| API-LIST-N03 | 연도 경계 | 2026-12-31, 2027-01-01 거래 등록 후 `year=2026&month=12` | 2026-12-31만 반환 |
| API-LIST-N04 | 정렬: 거래일 | T1~T5 등록 후 10월 조회 | 거래일 내림차순 (10-30 거래들이 10-01 거래보다 먼저) |
| API-LIST-N05 | 정렬: 등록 시각 | 같은 거래일로 T1, T2 순서로 등록 | 나중에 등록한 T2가 T1보다 먼저 |
| API-LIST-N06 | 정렬: ID | 같은 `date`, 같은 `created_at`인 행 2개를 DB에 직접 넣고 조회 | `id`가 큰 행이 먼저 |
| API-LIST-N07 | 빈 월 | 거래가 없는 `year=2026&month=8` | 200, `[]` |
| API-LIST-N08 | 응답 필드 | T2 조회 | `id`, `date`, `type`, `amount`, `category`, `memo`, `created_at` 7개 필드가 있고 `memo`는 `null` |
| API-LIST-E01 | 쿼리 누락 | `year` 없이 `month=10` | 422, `INVALID_QUERY` |
| API-LIST-E02 | 쿼리 누락 | `month` 없이 `year=2026` | 422, `INVALID_QUERY` |
| API-LIST-E03 | 월 범위 | `month=0`, `month=13` | 각각 422, `INVALID_QUERY` |
| API-LIST-E04 | 연도 범위 | `year=0`, `year=10000` | 각각 422, `INVALID_QUERY` |
| API-LIST-E05 | 정수 아님 | `year=abc`, `month=1.5` | 각각 422, `INVALID_QUERY` |
| API-LIST-E06 | DB 오류 | DB 읽기 실패 | 500, `DATABASE_ERROR` |

### 1.4 `POST /api/transactions`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-POST-N01 | 등록 | T1 본문 전송 | 201, 응답에 보낸 값 5개와 서버가 만든 `id`, `created_at` 포함. DB 행 1개 증가 |
| API-POST-N02 | 메모 생략 | `memo` 필드 없이 전송 | 201, `memo`가 `null` |
| API-POST-N03 | 빈 메모 | `memo`가 `""`, `"   "`, `null` | 각각 201, `memo`가 `null` |
| API-POST-N04 | 메모 공백 정리 | `memo`가 `"  점심  "` | 201, `memo`가 `"점심"` |
| API-POST-N05 | 최소 금액 | `amount`가 `1` | 201 |
| API-POST-N06 | 최대 금액 | `amount`가 `9007199254740991` | 201, 같은 값으로 저장·조회됨 |
| API-POST-N07 | 서버 필드 무시 | 본문에 `"id": 999`, `"created_at": "2000-01-01T00:00:00"` 포함 | 201, `id`는 999가 아니고 `created_at`은 요청 시점의 서버 시각 |
| API-POST-N08 | 알 수 없는 필드 | 본문에 `"title": "점심"` 포함 | 201, 응답과 DB에 `title`이 없음 |
| API-POST-N09 | 공통 분류 | `type`이 `expense`와 `income`인 경우 각각 `category`가 `기타` | 둘 다 201 |
| API-POST-N10 | 윤년 | `date`가 `2028-02-29` | 201 |
| API-POST-N11 | 등록 시각 형식 | N01 응답의 `created_at` | ISO 8601 형식(`YYYY-MM-DDTHH:MM:SS.ffffff`) |
| API-POST-N12 | 즉시 반영 | T1 등록 후 10월 목록·요약 조회 | 목록에 T1 포함, 요약 `expense`가 12500 증가 |
| API-POST-E01 | JSON 오류 | 본문이 `{"date": "2026-10-30",` | 400, `INVALID_JSON` |
| API-POST-E02 | 객체 아님 | 본문이 `[]` 또는 `"abc"` | 400, `INVALID_JSON` |
| API-POST-E03 | 필수값 누락 | `date`, `type`, `amount`, `category`를 하나씩 빼고 전송 | 각각 422, `MISSING_FIELD` |
| API-POST-E04 | 필수값 null | 필수 필드 4개를 하나씩 `null`로 전송 | 각각 422, `MISSING_FIELD` |
| API-POST-E05 | 날짜 형식 | `date`가 `"2026/10/30"`, `"20261030"`, `"2026-10-30T00:00:00"` | 각각 422, `INVALID_DATE` |
| API-POST-E06 | 없는 날짜 | `date`가 `"2026-02-30"`, `"2026-02-29"`(평년), `"2026-13-01"` | 각각 422, `INVALID_DATE` |
| API-POST-E07 | 유형 오류 | `type`이 `"transfer"`, `"Income"`, `""` | 각각 422, `INVALID_TYPE` |
| API-POST-E08 | 금액 범위 | `amount`가 `0`, `-1` | 각각 422, `INVALID_AMOUNT` |
| API-POST-E09 | 금액 소수 | `amount`가 `12.5` | 422, `INVALID_AMOUNT` |
| API-POST-E10 | 금액 문자열 | `amount`가 `"12500"` | 422, `INVALID_AMOUNT` |
| API-POST-E11 | 금액 불리언 | `amount`가 `true` | 422, `INVALID_AMOUNT` |
| API-POST-E12 | 금액 최대 초과 | `amount`가 `9007199254740992` | 422, `INVALID_AMOUNT` |
| API-POST-E13 | 분류 불일치 | `type`이 `income`, `category`가 `식비` | 422, `INVALID_CATEGORY` |
| API-POST-E14 | 없는 분류 | `category`가 `"간식"`, `""` | 각각 422, `INVALID_CATEGORY` |
| API-POST-E15 | 메모 타입 | `memo`가 `123`, `["a"]` | 각각 422, `INVALID_MEMO` |
| API-POST-E16 | 여러 오류 | `date`가 `"2026-02-30"`이고 `amount`가 `0` | 422, `INVALID_DATE` 하나만 반환 (검사 순서: date → type → amount → category → memo) |
| API-POST-E17 | 저장 안 됨 | E01~E16 각 요청 후 DB 행 수 확인 | 요청 전과 같음 |
| API-POST-E18 | DB 오류 | DB 쓰기 실패 | 500, `DATABASE_ERROR`, DB 행 수 변화 없음 |

### 1.5 `PUT /api/transactions/{id}`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-PUT-N01 | 수정 | T1을 `amount` 15000, `memo` "저녁"으로 수정 | 200, 바뀐 값 반환. `id`, `created_at`은 그대로 |
| API-PUT-N02 | 메모 생략 | 메모가 있던 T1을 `memo` 없이 수정 | 200, `memo`가 `null` |
| API-PUT-N03 | 유형 변경 | T1을 `type` income, `category` 월급으로 수정 | 200, 바뀐 값 반환 |
| API-PUT-N04 | 다른 달로 이동 | T1의 `date`를 `2026-11-02`로 수정 후 10월·11월 목록과 요약 조회 | 10월 목록에서 빠지고 11월 목록에 나타남. 10월 `expense`는 12500 감소, 11월 `expense`는 12500 증가 |
| API-PUT-N05 | 서버 필드 무시 | 본문에 `"id": 999`, `"created_at": "2000-01-01T00:00:00"` 포함 | 200, `id`와 `created_at`이 수정 전과 같음 |
| API-PUT-N06 | 정렬 유지 | T1, T2 순서로 등록 후 T1 수정 | 같은 날짜에서 여전히 T2가 T1보다 먼저 (수정해도 `created_at`이 바뀌지 않음) |
| API-PUT-E01 | id 형식 | `id`가 `abc`, `0`, `-1`, `9223372036854775808` | 각각 422, `INVALID_ID` |
| API-PUT-E02 | 없는 id | 존재하지 않는 `id` 9999, 올바른 본문 | 404, `TRANSACTION_NOT_FOUND` |
| API-PUT-E03 | 처리 순서 1 | 잘못된 `id`(`abc`) + 잘못된 본문(`amount` 0) | 422, `INVALID_ID` |
| API-PUT-E04 | 처리 순서 2 | 없는 `id` 9999 + 잘못된 본문(`amount` 0) | 422, `INVALID_AMOUNT` (본문 검사가 존재 확인보다 먼저) |
| API-PUT-E05 | 본문 검증 | API-POST-E01~E16과 같은 본문으로 T1 수정 | 각각 POST와 같은 상태 코드와 `code` |
| API-PUT-E06 | 분류 불일치 | T1의 `type`만 income으로 바꾸고 `category`는 식비 유지 | 422, `INVALID_CATEGORY` |
| API-PUT-E07 | 변경 안 됨 | E01~E06 각 요청 후 T1 조회 | T1 값이 수정 전과 같음 |
| API-PUT-E08 | DB 오류 | DB 쓰기 실패 | 500, `DATABASE_ERROR`, T1 값 변화 없음 |

### 1.6 `DELETE /api/transactions/{id}`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-DEL-N01 | 삭제 | T1 삭제 | 204, 응답 본문 없음. 목록에서 T1이 사라짐 |
| API-DEL-N02 | 요약 반영 | T1 삭제 후 10월 요약 조회 | `expense`가 12500 감소 |
| API-DEL-N03 | 다른 거래 유지 | T1~T3 중 T1 삭제 | T2, T3는 그대로 조회됨 |
| API-DEL-E01 | id 형식 | `id`가 `abc`, `0`, `-1`, `9223372036854775808` | 각각 422, `INVALID_ID` |
| API-DEL-E02 | 없는 id | 존재하지 않는 `id` 9999 | 404, `TRANSACTION_NOT_FOUND` |
| API-DEL-E03 | 두 번 삭제 | T1을 삭제한 뒤 같은 `id`로 다시 삭제 | 두 번째 요청은 404, `TRANSACTION_NOT_FOUND` |
| API-DEL-E04 | DB 오류 | DB 쓰기 실패 | 500, `DATABASE_ERROR`, T1이 그대로 남아 있음 |

### 1.7 `GET /api/summary`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-SUM-N01 | 합계 | T1~T5 등록 후 `year=2026&month=10` | 200, `income` 3000000, `expense` 62500, `balance` 2937500 |
| API-SUM-N02 | 다른 달 제외 | N01과 같음 | T4(9월), T5(11월) 금액이 포함되지 않음 |
| API-SUM-N03 | 빈 월 | 거래가 없는 `year=2026&month=8` | 200, `income` 0, `expense` 0, `balance` 0 |
| API-SUM-N04 | 음수 잔액 | 지출 T1만 있는 달 조회 | `income` 0, `expense` 12500, `balance` -12500 |
| API-SUM-N05 | 응답 필드 | N01 응답 | `year` 2026, `month` 10 포함 |
| API-SUM-E01 | 쿼리 누락 | `year` 또는 `month` 없음 | 422, `INVALID_QUERY` |
| API-SUM-E02 | 쿼리 범위 | `month=13`, `year=0` | 각각 422, `INVALID_QUERY` |
| API-SUM-E03 | 정수 아님 | `month=abc` | 422, `INVALID_QUERY` |
| API-SUM-E04 | DB 오류 | DB 읽기 실패 | 500, `DATABASE_ERROR` |

### 1.8 `POST /api/categories` (v0.4)

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-CADD-N01 | 분류 추가 | `{"type": "expense", "name": "간식"}` | 201, `{ id, type: "expense", name: "간식", is_default: false }`. 분류 목록에 나타남 |
| API-CADD-N02 | 이름 공백 정리 | `name`이 `"  간식  "` | 201, `name`이 `"간식"` |
| API-CADD-N03 | 다른 유형 같은 이름 | 지출 `부업`, 수입 `부업`을 차례로 추가 | 둘 다 201 |
| API-CADD-N04 | 최대 길이 | `name`이 20자 | 201 |
| API-CADD-N05 | 거래에 사용 | 지출 `간식` 추가 후 `type` expense, `category` 간식으로 거래 등록 | 201. 같은 이름으로 `type` income 거래 등록은 422 `INVALID_CATEGORY` |
| API-CADD-N06 | 서버 필드 무시 | 본문에 `"is_default": true`, `"id": 999` 포함 | 201, `is_default`는 `false`, `id`는 999가 아님 |
| API-CADD-E01 | JSON 오류 | 깨진 JSON, `[]` | 각각 400, `INVALID_JSON` |
| API-CADD-E02 | 필수값 누락 | `type` 또는 `name`을 빼거나 `null`로 전송 | 각각 422, `MISSING_FIELD` |
| API-CADD-E03 | 유형 오류 | `type`이 `"transfer"` | 422, `INVALID_TYPE` |
| API-CADD-E04 | 빈 이름 | `name`이 `""`, `"   "` | 각각 422, `INVALID_CATEGORY_NAME` |
| API-CADD-E05 | 길이 초과 | `name`이 21자 | 422, `INVALID_CATEGORY_NAME` |
| API-CADD-E06 | 문자열 아님 | `name`이 `123`, `["a"]` | 각각 422, `INVALID_CATEGORY_NAME` |
| API-CADD-E07 | 기본 분류와 중복 | 지출 `식비` 추가 | 409, `DUPLICATE_CATEGORY` |
| API-CADD-E08 | 사용자 분류와 중복 | 지출 `간식` 추가 후 지출 `" 간식 "` 추가 | 두 번째는 409, `DUPLICATE_CATEGORY` |
| API-CADD-E09 | 저장 안 됨 | E01~E08 각 요청 후 분류 수 확인 | 요청 전과 같음 |
| API-CADD-E10 | DB 오류 | DB 쓰기 실패 | 500, `DATABASE_ERROR` |

### 1.9 `PUT /api/categories/{id}` (v0.4)

준비: 지출 `간식`(C1)을 추가하고, C1으로 거래 2건(10월, 11월)을 등록한다. 수입 `간식`(C2)을 추가하고 C2로 거래 1건을 등록한다.

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-CREN-N01 | 이름 수정 | C1을 `커피·간식`으로 수정 | 200, `name`만 바뀌고 `id`, `type`, `is_default`는 그대로 |
| API-CREN-N02 | 거래 분류 변경 | N01 후 10월·11월 목록 조회 | C1을 쓰던 지출 거래 2건의 `category`가 `커피·간식`. C2(수입 `간식`) 거래는 `간식` 그대로 |
| API-CREN-N03 | 같은 이름 | C1을 `간식`(현재 이름)으로 수정 | 200, 변화 없음 |
| API-CREN-N04 | 이름 공백 정리 | `name`이 `"  커피  "` | 200, `name`이 `"커피"` |
| API-CREN-N05 | 유형 변경 무시 | 본문에 `"type": "income"` 포함 | 200, `type`은 `expense` 그대로 |
| API-CREN-E01 | id 형식 | `id`가 `abc`, `0`, `-1` | 각각 422, `INVALID_ID` |
| API-CREN-E02 | 없는 id | `id` 9999 | 404, `CATEGORY_NOT_FOUND` |
| API-CREN-E03 | 기본 분류 | 지출 `식비`의 `id`로 수정 | 409, `DEFAULT_CATEGORY_LOCKED`, `식비`와 그 거래는 그대로 |
| API-CREN-E04 | 기본 분류와 중복 | C1을 `식비`로 수정 | 409, `DUPLICATE_CATEGORY` |
| API-CREN-E05 | 사용자 분류와 중복 | 지출 `커피` 추가 후 C1을 `커피`로 수정 | 409, `DUPLICATE_CATEGORY` |
| API-CREN-E06 | 본문 검증 | `name` 없음, `""`, 21자, `123`, 깨진 JSON | 각각 API-CADD와 같은 상태 코드와 `code` |
| API-CREN-E07 | 처리 순서 | 없는 `id` 9999 + 빈 이름 | 422, `INVALID_CATEGORY_NAME` (본문 검사가 존재 확인보다 먼저) |
| API-CREN-E08 | 변경 안 됨 | E02~E07 각 요청 후 C1과 거래 조회 | C1 이름과 거래 분류가 요청 전과 같음 |
| API-CREN-E09 | 중간 실패 롤백 | `transactions` 수정 시 오류를 내는 트리거를 만든 뒤 C1 이름 수정 | 500, `DATABASE_ERROR`. C1 이름과 거래 분류가 모두 그대로 |
| API-CREN-E10 | DB 오류 | DB 쓰기 실패 | 500, `DATABASE_ERROR` |

### 1.10 `DELETE /api/categories/{id}` (v0.4)

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-CDEL-N01 | 삭제 | 거래가 없는 지출 `간식` 삭제 | 204, 본문 없음. 분류 목록에서 사라짐 |
| API-CDEL-N02 | 다른 유형 거래 무관 | 수입 `부업`으로 거래 등록, 지출 `부업`은 거래 없음 → 지출 `부업` 삭제 | 204. 수입 `부업`과 그 거래는 그대로 |
| API-CDEL-E01 | id 형식 | `id`가 `abc`, `0`, `-1` | 각각 422, `INVALID_ID` |
| API-CDEL-E02 | 없는 id | `id` 9999 | 404, `CATEGORY_NOT_FOUND` |
| API-CDEL-E03 | 두 번 삭제 | 같은 분류를 두 번 삭제 | 두 번째는 404, `CATEGORY_NOT_FOUND` |
| API-CDEL-E04 | 기본 분류 | 지출 `식비`의 `id`로 삭제 | 409, `DEFAULT_CATEGORY_LOCKED`, `식비`가 그대로 |
| API-CDEL-E05 | 사용 중 | 지출 `간식`으로 거래 2건 등록 후 `간식` 삭제 | 409, `CATEGORY_IN_USE`, `message`에 `2건` 포함. 분류와 거래가 그대로 |
| API-CDEL-E06 | DB 오류 | DB 쓰기 실패 | 500, `DATABASE_ERROR`, 분류가 그대로 |

### 1.11 `GET /api/backup` (v0.5)

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| API-BAK-N01 | 다운로드 응답 | 요청 | 200, `Content-Type`이 `application/vnd.sqlite3`, `Content-Disposition`이 `attachment; filename="budget-backup-YYYY-MM-DD-HHMM.db"` 형식이고 날짜·시각이 요청 시점의 서버 시각 |
| API-BAK-N02 | 내용 | T1~T5와 사용자 분류 `간식`을 등록한 뒤 백업 | 받은 파일이 SQLite 파일(`SQLite format 3` 헤더)로 열리고, `transactions` 5건과 `categories` 11건(기본 10 + `간식`)이 원본과 같음 |
| API-BAK-N03 | 복원 가능 | N02에서 받은 파일을 DB로 지정해 앱을 새로 실행 | 10월 목록·요약, 분류 목록이 원본과 같음 |
| API-BAK-N04 | 원본 유지 | 백업 전후로 원본 DB의 거래·분류 비교 | 바뀌지 않음, 백업 후에도 거래 등록이 정상 동작 |
| API-BAK-N05 | 빈 DB | 거래가 없는 상태에서 백업 | 받은 파일에 `transactions` 0건, 기본 분류 10건 |
| API-BAK-E01 | DB 오류 | DB 읽기 실패 | 500, `DATABASE_ERROR` (JSON 에러 형식) |
| API-BAK-E02 | 메서드 | `POST /api/backup` | 405, `METHOD_NOT_ALLOWED` |

---

## 2. 컴포넌트 테스트

### 2.1 `App`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-APP-N01 | 첫 화면 | 화면 열기 | 월 선택이 2026년 10월이고 분류, 10월 목록, 10월 요약을 서버에서 불러와 표시 |
| CMP-APP-N02 | 첫 로딩 | 응답이 오기 전 | 요약·목록·분류 자리에 각각의 로딩 문구 표시 |
| CMP-APP-N03 | 브라우저 변경 | 브라우저 A에서 거래 등록 후 브라우저 B로 접속 | B에서도 같은 거래가 보임 |
| CMP-APP-N04 | 서버 재실행 | 거래 등록 후 서버를 껐다 켜고 새로고침 | 등록한 거래가 그대로 보임 |
| CMP-APP-N05 | 브라우저 저장소 | 거래를 등록·수정한 뒤 개발자 도구에서 localStorage, sessionStorage, IndexedDB 확인 | 거래 데이터가 저장되어 있지 않음 |
| CMP-APP-E01 | 첫 로딩 연결 실패 | 서버를 끈 상태에서 화면 열기 | 요약·목록·분류 자리에 `서버에 연결할 수 없습니다.`와 `다시 시도` 버튼 표시 |
| CMP-APP-E02 | 연결 복구 | E01 상태에서 서버를 켜고 각 `다시 시도` 클릭 | 해당 영역이 정상 데이터로 바뀜 |

### 2.2 `MonthSelector`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-MONTH-N01 | 월 변경 | 2026년 9월 선택 | 요약·목록에 로딩 문구가 잠시 보인 뒤 9월 데이터 표시 |
| CMP-MONTH-N02 | 값 지움 | 입력값을 지움 | 2026년 10월이 그대로 유지되고 다시 조회하지 않음 |
| CMP-MONTH-N03 | 저장 중 잠금 | 거래 저장 요청 중 | 월 선택 비활성화, 응답 후 다시 활성화 |

### 2.3 `SummaryPanel`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-SUM-N01 | 금액 표시 | 수입 3000000, 지출 12500 | `3,000,000원`(파란색), `12,500원`(빨간색), 잔액 `2,987,500원` |
| CMP-SUM-N02 | 빈 월 | 거래가 없는 달 | 수입·지출·잔액 모두 `0원` |
| CMP-SUM-N03 | 음수 잔액 | 지출만 12500 있는 달 | 잔액 `-12,500원` |
| CMP-SUM-N04 | 갱신 | 거래 등록·수정·삭제 후 | 요약이 다시 조회되어 바뀐 합계 표시 |
| CMP-SUM-N05 | 로딩 | 요약 응답 전 | `월별 요약을 불러오는 중...` |
| CMP-SUM-E01 | 서버 에러 | 요약 API가 500 `DATABASE_ERROR` | `월별 요약을 불러오지 못했습니다.`와 `다시 시도` 버튼. 이전 금액은 보이지 않음 |
| CMP-SUM-E02 | 다시 시도 | E01 후 서버 정상화, `다시 시도` 클릭 | 정상 금액 표시 |

### 2.4 `TransactionForm`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-FORM-N01 | 기본값 | 화면 열기 | 제목 `거래 등록`, 유형 지출, 거래일 2026-10-30, 금액 빈 값, 분류 `분류 선택`, 메모 빈 값, 버튼 `저장` |
| CMP-FORM-N02 | 지출 분류 | 유형이 지출 | 분류 목록이 식비, 교통, 주거, 쇼핑, 의료, 문화·여가, 기타 |
| CMP-FORM-N03 | 유형 변경 | 지출에서 식비를 고른 뒤 수입으로 변경 | 분류 목록이 월급, 용돈, 기타로 바뀌고 선택이 `분류 선택`으로 초기화 |
| CMP-FORM-N04 | 등록 | 지출, 2026-10-30, 12500, 식비, 메모 비움으로 저장 | `POST` 본문의 `amount`가 숫자 12500, `memo`가 `null`. 요청 중 버튼 `저장 중...` 비활성화. 성공 후 폼이 CMP-FORM-N01의 기본값으로 초기화되고 목록·요약 갱신 |
| CMP-FORM-N05 | 다른 달 등록 | 10월을 보는 중 거래일 2026-09-15로 등록 | 월 선택이 2026년 9월로 바뀌고 등록한 거래가 목록에 보임 |
| CMP-FORM-N06 | 수정 모드 진입 | 목록에서 T1의 `수정` 클릭 | 제목 `거래 수정`, T1 값으로 채워짐, 버튼 `수정 저장`과 `취소` |
| CMP-FORM-N07 | 수정 저장 | N06 후 금액을 15000으로 바꿔 `수정 저장` | `PUT /api/transactions/{T1 id}` 호출. 성공 후 등록 모드로 돌아가고 목록·요약 갱신 |
| CMP-FORM-N08 | 다른 달로 수정 | 10월을 보는 중 T1 거래일을 2026-11-02로 수정 | 월 선택이 2026년 11월로 바뀌고 T1이 보임. 10월로 돌아가면 T1이 없고 요약도 줄어 있음 |
| CMP-FORM-N09 | 수정 취소 | 수정 모드에서 `취소` | 등록 모드로 돌아가고 N01의 기본값으로 초기화. 요청 없음 |
| CMP-FORM-N10 | 중복 클릭 | `저장`을 빠르게 두 번 클릭 | `POST` 요청이 한 번만 전송됨 |
| CMP-FORM-N11 | 분류 로딩 | 분류 응답 전 | `분류를 불러오는 중...`, 분류 선택과 저장 버튼 비활성화 |
| CMP-FORM-E01 | 거래일 없음 | 거래일을 지우고 저장 | `거래일을 입력해 주세요.`, 요청 없음 |
| CMP-FORM-E02 | 금액 없음 | 금액 빈 값으로 저장 | `금액을 입력해 주세요.`, 요청 없음 |
| CMP-FORM-E03 | 금액 오류 | 금액 `0`, `-5`, `12.5` | 각각 `금액은 1 이상의 정수여야 합니다.`, 요청 없음 |
| CMP-FORM-E04 | 분류 없음 | 분류를 고르지 않고 저장 | `분류를 선택해 주세요.`, 요청 없음 |
| CMP-FORM-E05 | 서버 검증 에러 | 서버가 422 `INVALID_CATEGORY` 응답 | 폼 위에 서버 `message` 표시, 입력값 유지, 버튼 다시 활성화 |
| CMP-FORM-E06 | 서버 DB 에러 | 저장 시 서버가 500 `DATABASE_ERROR` 응답 | `거래 내역을 저장하지 못했습니다.` 표시, 입력값 유지, 목록에 거래가 추가되지 않음 |
| CMP-FORM-E07 | 연결 실패 | 저장 직전 서버 종료 | `서버에 연결할 수 없습니다.` 표시, 입력값 유지 |
| CMP-FORM-E08 | 수정 대상 없음 | 수정 모드인 거래를 다른 브라우저에서 삭제한 뒤 `수정 저장` | `이미 삭제되었거나 없는 내역입니다.` 표시 후 목록·요약 다시 조회 |
| CMP-FORM-E09 | 에러 형식 아님 | 서버가 에러 형식이 아닌 500 응답 | `알 수 없는 오류가 발생했습니다. (상태 코드: 500)` |
| CMP-FORM-E10 | 분류 불러오기 실패 | 분류 API 실패 | 분류 선택 자리에 에러 문구와 `다시 시도` 버튼, 저장 버튼 비활성화. `다시 시도` 성공 시 분류 목록 표시 |
| CMP-FORM-E11 | 에러 문구 해제 | E01 후 거래일을 입력하고 정상 저장 | 에러 문구가 사라짐 |

### 2.5 `TransactionList`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-LIST-N01 | 표시 순서 | T1, T2, T3가 있는 10월 | 서버 응답 순서대로 T2, T1, T3 표시 |
| CMP-LIST-N02 | 빈 목록 | 거래가 없는 2026년 8월 | `2026년 8월에는 거래 내역이 없습니다.` |
| CMP-LIST-N03 | 로딩 | 목록 응답 전 | `거래 내역을 불러오는 중...` |
| CMP-LIST-N04 | 마지막 1건 삭제 | 거래가 1건인 달에서 삭제 | 빈 목록 문구로 바뀜 |
| CMP-LIST-E01 | 서버 에러 | 목록 API가 500 `DATABASE_ERROR` | `거래 내역을 불러오지 못했습니다.`와 `다시 시도` 버튼. 이전 목록은 보이지 않음 |
| CMP-LIST-E02 | 다시 시도 | E01 후 서버 정상화, `다시 시도` 클릭 | 정상 목록 표시 |

### 2.6 `TransactionItem`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-ITEM-N01 | 지출 표시 | T1 | 2026-10-30, 지출, 식비, `12,500원`(빨간색), 점심 |
| CMP-ITEM-N02 | 수입 표시 | T2 | 2026-10-30, 수입, 월급, `3,000,000원`(파란색), 메모 칸 비어 있음 |
| CMP-ITEM-N03 | 수정 중 강조 | T1의 `수정` 클릭 | T1 행이 강조 표시됨 |
| CMP-ITEM-N04 | 삭제 확인 창 | T1의 `삭제` 클릭 | 확인 창 문구 `2026-10-30 식비 12,500원 내역을 삭제할까요?` |
| CMP-ITEM-N05 | 삭제 확인 | N04에서 `확인` | 버튼 `삭제 중...` 비활성화 → `DELETE` 호출 → 목록에서 T1이 사라지고 요약 갱신 |
| CMP-ITEM-N06 | 삭제 취소 | N04에서 `취소` | 요청 없음, T1이 그대로 있음 |
| CMP-ITEM-N07 | 수정 중 삭제 | T1을 수정 모드로 연 뒤 T1 삭제 확인 | 삭제 성공 후 폼이 등록 모드로 돌아감 |
| CMP-ITEM-E01 | 이미 삭제됨 | 다른 브라우저에서 삭제한 T1을 삭제 확인 | `alert`로 `이미 삭제되었거나 없는 내역입니다.` 표시 후 목록·요약 다시 조회 |
| CMP-ITEM-E02 | 서버 DB 에러 | 삭제 시 서버가 500 `DATABASE_ERROR` 응답 | `alert`로 `거래 내역을 삭제하지 못했습니다.` 표시, T1이 목록에 남아 있고 버튼 다시 활성화 |
| CMP-ITEM-E03 | 연결 실패 | 삭제 직전 서버 종료 | `alert`로 `서버에 연결할 수 없습니다.` 표시 |

### 2.7 `StatusMessage`

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-STATUS-N01 | 로딩 | `kind` loading, `onRetry` 없음 | 문구만 표시, `다시 시도` 버튼 없음 |
| CMP-STATUS-N02 | 빈 목록 | `kind` empty | 문구만 표시, `다시 시도` 버튼 없음 |
| CMP-STATUS-N03 | 에러 + 다시 시도 | `kind` error, `onRetry` 있음 | 문구와 `다시 시도` 버튼 표시, 클릭 시 `onRetry` 한 번 호출 |

### 2.8 `CategoryManager` / `CategoryItem` (v0.4)

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-CAT-N01 | 카드 표시 | 화면 열기 | 입력 폼 아래에 `분류 관리` 카드. 지출 7개·수입 3개 기본 분류에 `기본` 표시, `수정`·`삭제` 버튼 없음 |
| CMP-CAT-N02 | 분류 추가 | 유형 지출, 이름 `간식` 입력 후 `추가` | 지출 목록 끝에 `간식`(수정·삭제 버튼 있음), 이름 입력칸이 비워짐, 입력 폼의 지출 분류 선택에도 `간식`이 생김 |
| CMP-CAT-N03 | 추가한 분류로 거래 등록 | N02 후 입력 폼에서 `간식` 선택해 저장 | 거래 목록에 `간식` 거래 표시 |
| CMP-CAT-N04 | 이름 수정 | `간식`의 `수정` 클릭 → `커피·간식` 입력 → `저장` | 분류 목록과 거래 목록의 이름이 `커피·간식`으로 바뀜 |
| CMP-CAT-N05 | 수정 취소 | `수정` 클릭 후 `취소` | 이름 그대로, 요청 없음 |
| CMP-CAT-N06 | 삭제 확인 창 / 취소 | 거래 없는 사용자 분류 `커피`의 `삭제` 클릭 후 취소 | 확인 창 `'커피'(지출) 분류를 삭제할까요?`, 분류 그대로 |
| CMP-CAT-N07 | 삭제 | N06에서 `확인` | 분류 목록과 입력 폼 분류 선택에서 `커피`가 사라짐 |
| CMP-CAT-N08 | 다른 선택 유지 | 입력 폼에서 `교통`을 고른 상태로 분류 추가 | 분류 목록을 다시 불러온 뒤에도 입력 폼의 `교통` 선택이 유지됨 |
| CMP-CAT-E01 | 빈 이름 | 이름 비우고 `추가` | `분류 이름을 입력해 주세요.`, 요청 없음 |
| CMP-CAT-E02 | 길이 초과 | 21자 이름으로 `추가` | `분류 이름은 20자 이하여야 합니다.`, 요청 없음 |
| CMP-CAT-E03 | 중복 | 지출 `식비` 추가 | `지출에 이미 '식비' 분류가 있습니다.` |
| CMP-CAT-E04 | 사용 중 삭제 | 거래 1건이 있는 사용자 분류 삭제 확인 | `이 분류를 사용하는 거래가 1건 있어 삭제할 수 없습니다.`, 분류 그대로 |
| CMP-CAT-E05 | 이름 수정 검사 | 수정 입력칸을 비우고 `저장` | `분류 이름을 입력해 주세요.`, 요청 없음, 수정 모드 유지 |
| CMP-CAT-E06 | 연결 실패 | 서버 종료 후 `추가` | `서버에 연결할 수 없습니다.`, 입력값 유지 |
| CMP-CAT-E07 | 불러오기 실패 | 분류 API 실패 | 카드 목록 자리에 에러 문구와 `다시 시도` 버튼 |

### 2.9 `BackupButton` (v0.5)

| ID | 대상 | 상황 | 기대 결과 |
|---|---|---|---|
| CMP-BAK-N01 | 버튼 위치 | 화면 열기 | 상단 제목 `가계부` 바로 옆에 `백업 다운로드` 버튼 |
| CMP-BAK-N02 | 다운로드 | 버튼 클릭 | `budget-backup-YYYY-MM-DD-HHMM.db` 파일이 다운로드되고, 파일이 `SQLite format 3`으로 시작함. 버튼이 다시 `백업 다운로드`로 돌아옴 |
| CMP-BAK-E01 | 연결 실패 | 서버 종료 후 버튼 클릭 | `alert`로 `서버에 연결할 수 없습니다.` 표시, 버튼 다시 활성화 |
