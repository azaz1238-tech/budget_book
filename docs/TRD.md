# TRD 초안 - 개인 가계부

> 기준 문서: `docs/PRD.md`, `docs/SPEC.md`, `CLAUDE.md`
> 대상 범위: MVP(v0.1 ~ v0.3)

## 0. 확정 사항

| 항목 | 결정 |
|---|---|
| 데이터 저장 위치 | 서버 컴퓨터의 SQLite `budget.db` |
| 분류 편집 | MVP에서는 고정 목록 (편집은 v0.4) |
| 기술 스택 | Python + FastAPI (백엔드), JavaScript (프런트엔드), SQLite (DB) |

## 1. 시스템 개요

```
[브라우저]                     [서버 컴퓨터]
 index.html  ──HTTP(JSON)──▶  Uvicorn ─▶ FastAPI ─▶ sqlite3 ─▶ budget.db
 app.js      ◀──────────────  (응답 JSON)
```

- 한 대의 컴퓨터에서 FastAPI 서버를 실행하고, 브라우저로 접속해 사용한다.
- 화면(HTML/CSS/JS)도 같은 FastAPI 서버가 제공한다. 별도의 프론트엔드 서버는 없다.
- 거래 데이터의 원본은 `budget.db`에만 있다. 브라우저 저장소(localStorage 등)에는 거래 데이터를 저장하지 않는다.

## 2. 기술 스택과 선택 이유

| 구분 | 기술 | 고른 이유 (한 줄 설명) |
|---|---|---|
| 언어 | Python 3.12 | 문법이 읽기 쉬워 초보자도 서버 코드를 따라가기 좋고, 프로젝트 `.venv`에 이미 설치되어 있다. |
| 웹 프레임워크 | FastAPI | 함수 하나에 주소(URL)를 붙이면 API가 되고, 입력값 검사와 API 문서(`/docs`)를 자동으로 만들어 준다. |
| 웹 서버 | Uvicorn | FastAPI 앱을 실제로 실행해 브라우저 요청을 받아 주는 프로그램으로, FastAPI 공식 문서가 기본으로 쓰는 서버다. |
| 입력 검증 | Pydantic | "금액은 1 이상의 정수" 같은 규칙을 클래스로 적어 두면 잘못된 요청을 자동으로 거절해 준다(FastAPI에 포함). |
| 데이터베이스 | SQLite | 설치나 별도 DB 서버 없이 `budget.db` 파일 하나로 동작해서, 혼자 쓰는 앱에 가장 간단하다. |
| DB 접근 | Python 표준 `sqlite3` 모듈 | Python에 기본 포함되어 추가 설치가 필요 없고, 테이블이 하나뿐이라 ORM 없이 SQL로 충분하다. |
| 화면 | HTML + CSS + 순수 JavaScript | 빌드 도구나 프레임워크 없이 브라우저가 바로 실행할 수 있어서, 화면 하나짜리 앱에 배울 것이 가장 적다. |
| 화면 ↔ 서버 통신 | 브라우저 `fetch` API | 브라우저에 기본 내장된 기능으로, 버튼을 누르면 페이지 이동 없이 서버에 JSON을 보내고 받을 수 있다. |
| 정적 파일 제공 | FastAPI `StaticFiles` | HTML/JS/CSS 파일을 같은 서버에서 내려 주므로 서버를 하나만 실행하면 된다. |
| 테스트 | pytest + FastAPI `TestClient`(httpx) | 서버를 띄우지 않고도 API를 호출해 결과를 확인할 수 있는 Python 표준 테스트 도구다. (pytest, httpx는 추가 설치 필요) |

### 사용하지 않는 것과 이유

- **SQLAlchemy 등 ORM**: 테이블 1개, 쿼리 몇 개뿐이라 배울 양에 비해 이득이 적다.
- **React/Vue 등 프론트엔드 프레임워크**: 화면이 하나이고 빌드 과정이 추가되어 MVP에 과하다.
- **템플릿 엔진(Jinja2)**: 화면은 정적 HTML로 두고 데이터는 JS가 API로 받아 그리므로 필요 없다.

## 3. 폴더 구조 (제안)

```
budget_book/
├─ app/
│  ├─ main.py          # FastAPI 앱 생성, API 라우트, 정적 파일 연결
│  ├─ db.py            # SQLite 연결, 테이블 생성, 쿼리 함수
│  ├─ schemas.py       # Pydantic 요청/응답 모델
│  └─ categories.py    # 고정 분류 목록
├─ static/
│  ├─ index.html       # 화면 구조
│  ├─ app.js           # 버튼 처리, fetch 호출, 목록·요약 그리기
│  └─ style.css        # 스타일 (수입 파란색, 지출 빨간색)
├─ tests/
│  └─ test_api.py
├─ docs/
├─ requirements.txt
├─ README.md           # 실행 방법, budget.db 수동 백업 안내
└─ budget.db           # 실행 시 자동 생성 (버전 관리 제외)
```

## 4. 데이터베이스 설계

### 4.1 테이블

```sql
CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,                                   -- 'YYYY-MM-DD'
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount      INTEGER NOT NULL CHECK (amount >= 1),
    category    TEXT    NOT NULL,
    memo        TEXT,                                               -- 선택, 빈 값은 NULL
    created_at  TEXT    NOT NULL                                    -- 서버가 기록, ISO 8601
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
```

- `date`를 `YYYY-MM-DD` 문자열로 저장하면 문자열 비교만으로 날짜 순서와 월 범위 검색이 정확하다.
- `amount`, `type`은 DB에도 `CHECK` 제약을 걸어, 코드 실수가 있어도 잘못된 값이 저장되지 않게 한다.
- `category`의 유효성(유형별 허용 목록)은 서버 코드에서 검사한다. v0.4에서 분류 테이블로 바꿀 때 DB 제약 변경 없이 확장하기 위해서다.
- `created_at`은 서버의 현재 시각을 마이크로초까지 포함한 ISO 8601 문자열로 기록한다.

### 4.2 주요 쿼리

| 용도 | 쿼리 요약 |
|---|---|
| 월별 목록 | `WHERE date >= '2026-10-01' AND date < '2026-11-01' ORDER BY date DESC, created_at DESC, id DESC` |
| 월별 요약 | `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0), COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0)` + 같은 월 조건 |
| 잔액 | 서버에서 `수입 합계 - 지출 합계`로 계산해 응답에 포함 |

- 모든 쿼리는 `?` 자리표시자를 사용해 값을 전달한다(SQL 인젝션 방지).

### 4.3 연결과 트랜잭션

- 요청마다 `sqlite3.connect("budget.db")`로 연결을 열고, 응답 후 닫는다.
- 쓰기 작업은 `with conn:` 블록 안에서 실행해 성공 시 커밋, 오류 시 롤백한다.
- 서버 시작 시 테이블이 없으면 `CREATE TABLE IF NOT EXISTS`로 만든다.
- DB 파일 경로는 기본값 `budget.db`, 테스트에서는 환경 변수 `BUDGET_DB_PATH`로 임시 파일을 지정한다.

## 5. API 설계

모든 요청/응답 본문은 JSON이다.

| 메서드 | 경로 | 설명 | 성공 응답 |
|---|---|---|---|
| GET | `/api/categories` | 유형별 고정 분류 목록 | 200 |
| GET | `/api/transactions?year=2026&month=10` | 해당 월 거래 목록(정렬 적용) | 200 |
| POST | `/api/transactions` | 거래 등록 | 201 + 생성된 거래 |
| PUT | `/api/transactions/{id}` | 거래 수정 | 200 + 수정된 거래 |
| DELETE | `/api/transactions/{id}` | 거래 영구 삭제 | 204 |
| GET | `/api/summary?year=2026&month=10` | 해당 월 수입·지출 합계, 잔액 | 200 |

### 5.1 요청 본문 (등록·수정 공통)

```json
{
  "date": "2026-10-30",
  "type": "expense",
  "amount": 12500,
  "category": "식비",
  "memo": "점심"
}
```

- `id`, `created_at`은 요청으로 받지 않는다. 보내도 무시하며, 수정 시에도 `created_at`은 바뀌지 않는다.

### 5.2 응답 예시

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

```json
{ "year": 2026, "month": 10, "income": 3000000, "expense": 12500, "balance": 2987500 }
```

### 5.3 검증 규칙

| 필드 | 규칙 | 구현 |
|---|---|---|
| `date` | 필수, 실제 존재하는 날짜 | Pydantic `date` 타입 |
| `type` | `income` 또는 `expense` | `Literal["income", "expense"]` |
| `amount` | 필수, 정수, 1 이상 | `StrictInt` + `ge=1` (`12.5`, `"1000"`, `true` 거절) |
| `category` | 선택한 `type`의 고정 분류 중 하나 | Pydantic 모델 검증기에서 `categories.py`와 비교 |
| `memo` | 선택, 앞뒤 공백 제거 후 빈 문자열이면 `null` | 검증기에서 정리 |
| `year`, `month` | `month`는 1~12 | Query 파라미터 검증 |

### 5.4 오류 응답

| 상황 | 상태 코드 | 화면 처리 |
|---|---|---|
| 입력값 검증 실패 | 422 | 어떤 항목이 잘못됐는지 폼 근처에 표시 |
| 없는 `id` 수정·삭제 | 404 | "이미 삭제되었거나 없는 내역입니다" 표시 후 목록 새로고침 |
| DB 오류 등 서버 오류 | 500 | 오류 메시지를 화면에 표시 (숨기지 않음) |
| 서버에 연결 불가 | (fetch 실패) | "서버에 연결할 수 없습니다" 표시 |

- 서버 오류는 로그에 기록하고, 실패한 작업이 성공한 것처럼 보이지 않게 한다.

## 6. 화면 설계

- 화면은 한 페이지(`index.html`)로 구성한다.
  - **월 선택**: `<input type="month">`, 기본값은 오늘이 속한 달
  - **월별 요약**: 수입 합계(파란색), 지출 합계(빨간색), 잔액
  - **입력 폼**: 유형(라디오), 거래일(`<input type="date">`), 금액, 분류(선택한 유형에 맞게 목록 변경), 메모, 저장 버튼
  - **거래 목록**: 거래일, 유형, 분류, 금액, 메모, 수정·삭제 버튼 / 내역이 없으면 빈 상태 안내
- 금액 표시: `Number.toLocaleString('ko-KR') + '원'` → `12,500원`
- 수정: 목록의 수정 버튼을 누르면 입력 폼에 값을 채우고, 저장 시 `PUT`을 호출한다.
- 삭제: `window.confirm("2026-10-30 식비 12,500원 내역을 삭제할까요?")`에서 확인한 경우에만 `DELETE`를 호출한다.
- 등록·수정·삭제·월 변경 후에는 항상 서버에서 목록과 요약을 다시 받아 그린다. 화면이 서버 데이터와 어긋나지 않게 하기 위해서다.

## 7. 버튼을 누른 뒤 DB에 저장되기까지의 흐름

"지출 / 2026-10-30 / 12,500 / 식비 / 점심"을 입력하고 **저장** 버튼을 누른 경우.

### 7.1 단계별 흐름

| 단계 | 위치 | 일어나는 일 |
|---|---|---|
| 1 | 브라우저 (HTML) | 사용자가 저장 버튼을 누르면 폼의 `submit` 이벤트가 발생한다. |
| 2 | 브라우저 (`app.js`) | 이벤트 처리 함수가 `event.preventDefault()`로 페이지 새로고침을 막는다. |
| 3 | 브라우저 (`app.js`) | 입력값을 읽어 빈 필수값, 1 미만 금액 같은 간단한 실수를 먼저 확인한다. 문제가 있으면 여기서 오류를 보여 주고 멈춘다. |
| 4 | 브라우저 (`app.js`) | 입력값을 JSON으로 만든다. 금액은 숫자로 변환하고, 빈 메모는 `null`로 보낸다. |
| 5 | 브라우저 (`app.js`) | 중복 클릭을 막기 위해 저장 버튼을 잠시 비활성화한다. |
| 6 | 브라우저 → 서버 | `fetch('/api/transactions', { method: 'POST', body: JSON })`로 요청을 보낸다. |
| 7 | 서버 (Uvicorn) | Uvicorn이 HTTP 요청을 받아 FastAPI 앱에 넘긴다. |
| 8 | 서버 (FastAPI) | 주소(`POST /api/transactions`)를 보고 등록 함수를 찾는다. |
| 9 | 서버 (Pydantic) | JSON을 요청 모델로 변환하면서 날짜 형식, 유형, 정수 금액, 1 이상, 유형별 분류를 검사한다. 실패하면 DB에 가지 않고 422 응답을 돌려준다. |
| 10 | 서버 (`main.py`) | 서버가 현재 시각으로 `created_at`을 만든다. |
| 11 | 서버 (`db.py`) | `budget.db`에 연결하고 `INSERT INTO transactions (...) VALUES (?, ?, ?, ?, ?, ?)`를 실행한다. |
| 12 | 서버 (SQLite) | SQLite가 `CHECK` 제약을 한 번 더 확인하고 행을 추가한 뒤, 커밋하면 파일에 저장된다. 이 시점부터 서버를 재시작해도 데이터가 남는다. |
| 13 | 서버 (`db.py`) | 새로 생긴 `id`로 저장된 행을 다시 읽는다. |
| 14 | 서버 → 브라우저 | 저장된 거래를 JSON으로 만들어 `201 Created`로 응답한다. |
| 15 | 브라우저 (`app.js`) | 응답이 성공이면 폼을 비우고, 실패(422/500/연결 실패)면 오류 메시지를 표시한다. 어느 경우든 저장 버튼을 다시 활성화한다. |
| 16 | 브라우저 (`app.js`) | 성공한 경우 `GET /api/transactions`, `GET /api/summary`를 다시 호출해 목록과 월별 요약을 새로 그린다. |

### 7.2 흐름 그림

```
[저장 버튼 클릭]
      │
      ▼
 app.js: 기본 동작 막기 → 간단 검사 ──실패──▶ 화면에 오류 표시 (끝)
      │ 통과
      ▼
 JSON 만들기 → fetch POST /api/transactions
      │
      ▼
 Uvicorn → FastAPI 라우트 → Pydantic 검증 ──실패──▶ 422 응답 → 화면에 오류 표시
      │ 통과
      ▼
 created_at 기록 → sqlite3 INSERT → COMMIT ──DB 오류──▶ 롤백, 500 응답 → 화면에 오류 표시
      │ 성공
      ▼
 budget.db 파일에 저장 완료 → 201 응답(저장된 거래 JSON)
      │
      ▼
 app.js: 폼 초기화 → 목록·요약 다시 조회 → 화면 갱신
```

### 7.3 수정·삭제 흐름의 차이

- **수정**: 6단계가 `PUT /api/transactions/{id}`가 되고, 10단계(`created_at` 생성)를 하지 않으며, 11단계가 `UPDATE ... WHERE id = ?`가 된다. 바뀐 행이 0개면 404를 돌려준다.
- **삭제**: 3~4단계 대신 `window.confirm` 확인 창을 띄우고, 취소하면 아무 요청도 보내지 않는다. 확인하면 `DELETE /api/transactions/{id}` → `DELETE FROM transactions WHERE id = ?` → 204 응답 순서로 진행한다.
- 화면 검사(3단계)는 사용자 편의를 위한 것이고, 최종 검사는 항상 서버(9단계)와 DB 제약(12단계)이 담당한다.

## 8. 테스트 계획

| 구분 | 확인 내용 |
|---|---|
| 등록 | 정상 등록 시 201, 응답에 `id`·`created_at` 포함, 메모 없이도 등록 가능 |
| 검증 | 필수값 누락, `amount`가 0·음수·소수·문자열, 잘못된 `type`, 유형과 맞지 않는 분류 → 422, DB에 저장 안 됨 |
| 조회·정렬 | 거래일 내림차순, 같은 날은 `created_at` 내림차순, 그다음 `id` 내림차순 |
| 월 필터 | 다른 달 거래가 목록과 요약에 포함되지 않음, 월 경계(말일·1일) 확인 |
| 요약 | 수입 합계, 지출 합계, 잔액 = 수입 - 지출, 내역이 없으면 모두 0 |
| 수정 | 값이 바뀌고 `created_at`은 그대로, 다른 달로 옮기면 두 달의 요약이 모두 바뀜, 없는 `id`는 404 |
| 삭제 | 삭제 후 조회되지 않음, 없는 `id`는 404 |
| 영속성 | 같은 DB 파일로 앱을 다시 만들어도 데이터가 남아 있음 |

- 테스트마다 임시 DB 파일을 사용해 실제 `budget.db`를 건드리지 않는다.
- 삭제 확인 창, 금액 표시 형식, 색상 구분은 브라우저에서 직접 확인한다.

## 9. 실행 방법 (예정)

```powershell
# 의존성 설치
.venv\Scripts\python -m pip install -r requirements.txt

# 서버 실행 후 브라우저에서 http://127.0.0.1:8000 접속
.venv\Scripts\python -m uvicorn app.main:app --reload

# 테스트
.venv\Scripts\python -m pytest
```

- 서버는 기본적으로 `127.0.0.1`(내 컴퓨터)에서만 접속 가능하게 실행한다. 로그인이 없으므로 외부에 공개하지 않는다.
- 백업은 서버를 끈 상태에서 `budget.db` 파일을 복사한다. 이 안내는 README에 적는다.

## 10. 범위 밖 (PRD와 동일)

로그인·다중 사용자, 동기화·온라인 백업, 앱 내 DB 백업 버튼(v0.5), 사용자 분류 편집(v0.4), 예산·반복 거래·알림, 영수증 자동 분류, 은행 연동, 통계 차트, 파일 내보내기, 삭제 복구.
