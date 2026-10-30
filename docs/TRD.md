# TRD 초안 - 개인 가계부

> 기준 문서: `docs/PRD.md`, `docs/SPEC.md`, `CLAUDE.md`
> 대상 범위: MVP(v0.1 ~ v0.3), v0.4 사용자 분류 편집(11절), v0.5 데이터베이스 백업(12절), v0.6 분류별 필터(13절), v0.7 ~ v0.11 기능(14절)

## 0. 확정 사항

| 항목 | 결정 |
|---|---|
| 데이터 저장 위치 | 서버 컴퓨터의 SQLite `budget.db` |
| 분류 편집 | MVP에서는 고정 목록. v0.4에서 사용자 분류 추가·이름 수정·삭제 (기본 분류는 고정, 11절) |
| 기술 스택 | Python + FastAPI (백엔드), JavaScript (프런트엔드), SQLite (DB) |
| 백업 | v0.5에서 브라우저 다운로드 방식. 복원은 앱에서 제공하지 않음 (12절) |
| 통계 표시 | v0.8 분류별 지출은 차트 라이브러리 없이 CSS 막대로 그림 (14.2절) |
| 고정 거래 | v0.11에서 수동 불러오기 버튼 방식. 자동 스케줄러 없음 (14.5절) |

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
| DB 접근 | Python 표준 `sqlite3` 모듈 | Python에 기본 포함되어 추가 설치가 필요 없고, 테이블이 1~2개뿐이라 ORM 없이 SQL로 충분하다. |
| 화면 | HTML + CSS + 순수 JavaScript | 빌드 도구나 프레임워크 없이 브라우저가 바로 실행할 수 있어서, 화면 하나짜리 앱에 배울 것이 가장 적다. |
| 화면 ↔ 서버 통신 | 브라우저 `fetch` API | 브라우저에 기본 내장된 기능으로, 버튼을 누르면 페이지 이동 없이 서버에 JSON을 보내고 받을 수 있다. |
| 정적 파일 제공 | FastAPI `StaticFiles` | HTML/JS/CSS 파일을 같은 서버에서 내려 주므로 서버를 하나만 실행하면 된다. |
| 테스트 | pytest + FastAPI `TestClient`(httpx) | 서버를 띄우지 않고도 API를 호출해 결과를 확인할 수 있는 Python 표준 테스트 도구다. (`requirements.txt`에 포함) |

### 사용하지 않는 것과 이유

- **SQLAlchemy 등 ORM**: 테이블 1~2개, 쿼리 몇 개뿐이라 배울 양에 비해 이득이 적다.
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
│  ├─ test_api.py      # API 테스트
│  └─ test_sample.py   # 샘플 테스트 (1 + 1 = 2)
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
| 월별 목록 | `WHERE date BETWEEN '2026-10-01' AND '2026-10-31' ORDER BY date DESC, created_at DESC, id DESC` (말일은 달마다 계산) |
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
| 요청 본문이 올바른 JSON이 아님 | 400 | 폼 근처에 오류 메시지 표시 |
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

## 9. 실행 방법

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

로그인·다중 사용자, 동기화·온라인 백업, 앱 내 백업 복원, 알림, 자동 등록 스케줄러, 영수증 자동 분류, 은행 연동, 차트 라이브러리 통계 차트, 파일 내보내기, 삭제 복구. 사용자 분류 편집은 v0.4(11절), 앱 내 DB 백업은 v0.5(12절), 예산·고정 거래는 v0.10·v0.11(14절)에서 다룬다.

## 11. v0.4 사용자 분류 편집

> 요구사항: SPEC FR-8, PRD F-10

### 11.1 설계 방향

| 결정 | 이유 (한 줄 설명) |
|---|---|
| 분류를 `categories` 테이블에 저장하고 기본 분류도 같은 테이블에 넣는다 | 이름 중복 금지를 DB의 `UNIQUE` 제약으로 기본 분류까지 한 번에 지킬 수 있다. |
| `transactions.category`는 지금처럼 분류 **이름 문자열**로 둔다 | 기존 `budget.db`의 거래 테이블을 바꾸지 않아도 되고, 거래 API의 요청·응답 모양도 그대로 유지된다. |
| 거래와 분류는 `(type, category)` ↔ `(type, name)`으로 연결한다 | 같은 유형 안에서 이름이 유일하므로 이 두 값만으로 분류를 정확히 찾을 수 있다. |
| 외래 키(FOREIGN KEY)는 쓰지 않고, 이름 수정·삭제를 한 트랜잭션 안에서 코드로 처리한다 | SQLite는 이미 있는 테이블에 외래 키를 추가할 수 없어 테이블을 새로 만들어 옮겨야 하는데, 혼자 쓰는 앱에 비해 이전 작업이 크다. |

### 11.2 테이블 추가와 기존 DB 이전

```sql
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    name        TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 20),
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    UNIQUE (type, name)
);
```

- 서버 시작 시 `init_db()`가 `categories` 테이블을 만들고, 기본 분류 10개를 `INSERT OR IGNORE`로 넣는다. (`is_default = 1`)
- MVP에서 쓰던 `budget.db`도 그대로 사용할 수 있다. 기존 거래의 분류는 모두 기본 분류이므로 별도 데이터 변환이 필요 없다.
- `transactions` 테이블은 바꾸지 않는다.

### 11.3 주요 처리

| 작업 | 처리 (모두 `with conn:` 한 트랜잭션) |
|---|---|
| 분류 목록 | `SELECT ... FROM categories ORDER BY is_default DESC, id` → 기본 분류가 먼저, 사용자 분류는 추가한 순서 |
| 분류 추가 | 같은 `(type, name)`이 있으면 거절, 없으면 `INSERT` (`is_default = 0`) |
| 이름 수정 | 기본 분류면 거절 → 새 이름 중복이면 거절 → `UPDATE categories SET name = 새 이름` + `UPDATE transactions SET category = 새 이름 WHERE type = ? AND category = 옛 이름` |
| 분류 삭제 | 기본 분류면 거절 → `SELECT COUNT(*) FROM transactions WHERE type = ? AND category = ?`가 1 이상이면 건수와 함께 거절 → 0이면 `DELETE` |
| 거래 등록·수정 | 분류 검사를 `categories.py` 상수 대신 `categories` 테이블에서 `(type, name)`이 있는지로 바꾼다 |

- 이름 수정에서 두 `UPDATE` 중 하나라도 실패하면 둘 다 롤백되어, 분류 이름과 거래의 분류가 어긋나지 않는다.
- 분류 이름은 앞뒤 공백을 제거한 뒤 저장한다.

### 11.4 API 변경 (상세는 API_SPEC에서 정한다)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/categories` | **응답 모양 변경**: 이름 배열 대신 `id`, `name`, `is_default`를 가진 객체 배열 |
| POST | `/api/categories` | 분류 추가 (`type`, `name`) |
| PUT | `/api/categories/{id}` | 사용자 분류 이름 수정 (`name`) |
| DELETE | `/api/categories/{id}` | 사용자 분류 삭제 |

- `GET /api/categories` 응답 모양이 바뀌므로 화면(`app.js`)과 기존 테스트(`API-CAT-N01`)도 함께 바꾼다.

### 11.5 화면 변경 (상세는 COMPONENT_SPEC에서 정한다)

- 분류 관리 영역을 추가한다: 유형별 분류 목록, 분류 추가 입력, 사용자 분류의 이름 수정·삭제 버튼.
- 기본 분류에는 수정·삭제 버튼을 표시하지 않는다.
- 분류를 추가·수정·삭제하면 분류 목록, 입력 폼의 분류 선택, 거래 목록(이름 수정 시)을 다시 불러온다.

### 11.6 테스트 계획 추가

| 구분 | 확인 내용 |
|---|---|
| 초기화 | 새 DB와 MVP 시절 DB 모두에서 기본 분류 10개가 한 번만 생김 (서버 재시작해도 중복 없음) |
| 추가 | 유형별 추가, 추가한 분류로 거래 등록 가능, 빈 이름·같은 유형 중복(기본 분류 포함) 거절, 다른 유형 같은 이름 허용 |
| 이름 수정 | 사용자 분류 이름 변경 시 그 분류의 거래만 새 이름으로 바뀜 (다른 유형의 같은 이름 거래는 그대로), 기본 분류 수정 거절, 중복 이름 거절 |
| 삭제 | 거래 없는 사용자 분류 삭제, 거래 있는 분류는 건수와 함께 거절, 기본 분류 삭제 거절, 없는 id는 404 |
| 일관성 | 이름 수정 중 DB 오류가 나면 분류 이름과 거래의 분류가 모두 바뀌지 않음 |

### 11.7 확정 사항

| 항목 | 결정 |
|---|---|
| 분류 이름 길이 | 앞뒤 공백 제거 후 1~20자 |
| 분류 삭제 | 거래 삭제처럼 확인 창을 띄우고, 확인한 경우에만 삭제 요청 |
| 분류 관리 화면 위치 | 입력 폼 아래 별도 카드 |
| 새 에러 코드 | API_SPEC 1.3절 |

## 12. v0.5 데이터베이스 백업

> 요구사항: SPEC FR-9, PRD F-11

### 12.1 설계 방향

| 결정 | 이유 (한 줄 설명) |
|---|---|
| 백업은 SQLite 내장 백업 기능(`Connection.backup()`)으로 만든다 | 서버가 실행 중이어도 깨지지 않은 복사본을 만들어 준다. 파일을 그냥 복사하면 쓰는 도중의 파일이 복사될 수 있다. |
| 백업을 메모리 DB에 받은 뒤 `serialize()`로 바이트를 꺼내 응답한다 | 서버 디스크에 임시 파일을 남기지 않는다. 혼자 쓰는 가계부라 DB 크기가 작아 메모리에 담아도 충분하다. |
| `GET /api/backup` 응답에 `Content-Disposition: attachment`와 파일 이름을 붙인다 | 브라우저가 화면 이동 없이 파일로 저장한다. |
| 화면은 `fetch`로 받아 `Blob`을 만든 뒤 다운로드시킨다 | 실패했을 때 JSON 에러 화면으로 넘어가지 않고 에러 문구를 보여 줄 수 있다. |
| 파일 이름은 서버 시각으로 `budget-backup-YYYY-MM-DD-HHMM.db` | 언제 백업했는지 이름만 보고 알 수 있고, 이름 순서가 시간 순서와 같다. |

### 12.2 처리 흐름

1. 사용자가 상단 제목 옆 `백업 다운로드` 버튼을 누른다.
2. `app.js`가 버튼을 비활성화하고 `GET /api/backup`을 호출한다.
3. 서버가 `budget.db`에 연결해 메모리 DB로 백업하고, 바이트로 꺼내 `application/vnd.sqlite3`으로 응답한다.
4. `app.js`가 응답의 `Content-Disposition`에서 파일 이름을 읽고 `Blob`으로 다운로드를 시작한다.
5. 실패하면(서버 에러, 연결 실패) 에러 메시지를 `alert`로 보여 준다. 어느 경우든 버튼을 다시 활성화한다.

### 12.3 데이터와 API 변경

- 테이블과 데이터 모델은 바뀌지 않는다. 백업은 DB를 읽기만 한다.
- API 1개 추가: `GET /api/backup` (상세는 API_SPEC 3.10절)
- 이 API만 응답 본문이 JSON이 아니라 SQLite 파일이다. 에러 응답은 다른 API와 같은 JSON 형식이다.

### 12.4 수동 복원 (README에 안내)

1. 서버를 끈다.
2. 지금 `budget.db`를 다른 이름으로 바꿔 보관한다.
3. 백업 파일 이름을 `budget.db`로 바꿔 프로젝트 폴더에 넣는다.
4. 서버를 켠다.

### 12.5 테스트 계획 추가

| 구분 | 확인 내용 |
|---|---|
| 다운로드 | 200, `Content-Type`이 `application/vnd.sqlite3`, `Content-Disposition`에 날짜·시각이 들어간 파일 이름 |
| 내용 | 받은 파일이 SQLite 파일로 열리고, 거래 내역과 분류(사용자 분류 포함)가 백업 시점과 같음 |
| 복원 가능 | 받은 파일을 DB로 지정해 앱을 실행하면 같은 거래 내역과 분류가 조회됨 |
| 원본 유지 | 백업 후 원본 DB의 데이터가 바뀌지 않음 |
| 에러 | DB 오류 시 500 `DATABASE_ERROR`, 지원하지 않는 메서드는 405 |
| 화면 | 버튼 위치, 다운로드된 파일 이름과 내용, 연결 실패 시 에러 문구 |

## 13. v0.6 분류별 필터

> 요구사항: SPEC FR-10, PRD F-12

### 13.1 설계 방향

| 결정 | 이유 (한 줄 설명) |
|---|---|
| 기존 `GET /api/transactions`, `GET /api/summary`에 선택 쿼리 `type`, `category`를 추가한다 | 새 API 없이 같은 정렬·월 범위·합계 규칙을 그대로 재사용할 수 있다. |
| `type`과 `category`는 항상 함께 받는다 | 같은 이름이 지출·수입에 모두 있을 수 있어(`기타`), 이름만으로는 분류가 정해지지 않는다. |
| 필터 합계는 서버의 요약 API로 계산한다 | 월별 요약과 같은 계산 코드를 써서 합계가 어긋나지 않는다. |
| 월별 요약 카드는 필터 없이 그대로 둔다 | 필터를 걸어도 그 달 전체 흐름은 계속 보이게 한다. |
| 테이블·인덱스는 바꾸지 않는다 | 한 달 거래만 거르므로 기존 날짜 인덱스로 충분하다. |

### 13.2 쿼리

```sql
-- 목록
WHERE date BETWEEN ? AND ? AND type = ? AND category = ?
ORDER BY date DESC, created_at DESC, id DESC
-- 합계: 월별 요약 쿼리에 같은 조건 추가
```

### 13.3 화면

- 거래 내역 카드 제목 아래에 `분류 필터` 선택 상자(`전체`, 지출 분류 묶음, 수입 분류 묶음)를 둔다.
- 필터를 고르면 목록과 함께 `식비(지출) · 3건 · 합계 62,500원` 같은 한 줄을 보여 준다.
- 분류 목록을 다시 불러왔을 때 필터의 분류가 없어졌으면 `전체`로 돌린다. 필터의 분류 이름을 수정하면 필터도 새 이름으로 바꾼다.

### 13.4 테스트 계획 추가

| 구분 | 확인 내용 |
|---|---|
| 목록 필터 | 고른 유형·분류의 해당 월 거래만, 정렬 유지. 같은 이름 다른 유형은 제외 |
| 합계 필터 | 고른 분류의 합계만 계산 (지출 분류면 `income` 0) |
| 에러 | `type`·`category` 중 하나만 있거나 `type`이 잘못되면 422 `INVALID_QUERY` |
| 화면 | 필터 선택, 건수·합계 표시, 월 변경 시 유지, 거래 변경 시 갱신, 분류 이름 수정·삭제 시 필터 처리 |

## 14. v0.7 ~ v0.11 기능

> 요구사항: SPEC FR-11 ~ FR-15, PRD F-13 ~ F-17
> 구현 순서는 버전 순서를 따른다. v0.10 예산은 v0.8 분류별 지출 위에 얹으므로 v0.8 다음에 한다.

### 14.1 v0.7 월 이동 버튼

| 결정 | 이유 (한 줄 설명) |
|---|---|
| 화면만 바꾸고 서버는 바꾸지 않는다 | `state.selected`를 한 달 앞뒤로 계산한 뒤 기존 월 변경 처리(`handleMonthChange`)를 부르면 목록·요약·필터 처리가 그대로 재사용된다. |
| 연도 넘김은 화면에서 계산한다 | 1월의 이전 달은 전년 12월, 12월의 다음 달은 다음 해 1월이다. |
| 범위 끝(0001년 1월, 9999년 12월)에서는 버튼을 끈다 | 서버가 받는 연도 범위(1~9999)를 벗어난 요청을 보내지 않는다. |

### 14.2 v0.8 분류별 지출 합계

| 결정 | 이유 (한 줄 설명) |
|---|---|
| `GET /api/summary/categories?year&month`를 추가한다 | DB의 `GROUP BY`로 분류별 합계를 계산해 화면이 거래 전체를 받아 더하지 않아도 된다. |
| 스키마·인덱스는 바꾸지 않는다 | 한 달 범위를 기존 `date` 인덱스로 찾은 뒤 묶기만 하면 된다. |
| 정렬(합계 큰 순, 같으면 이름 순)은 SQL에서 한다 | 화면과 테스트가 같은 순서를 기대할 수 있다. |
| 응답에 그 달 지출 합계(`total`)를 함께 보낸다 | 화면이 비율(합계 ÷ total)과 막대 길이를 바로 계산할 수 있다. |
| 막대는 CSS `width: N%`로 그린다 | 차트 라이브러리 없이 충분하고, 외부 파일을 늘리지 않는다. |

```sql
SELECT category, SUM(amount) AS amount, COUNT(*) AS count
FROM transactions
WHERE date BETWEEN ? AND ? AND type = 'expense'
GROUP BY category
ORDER BY amount DESC, category
```

### 14.3 v0.9 검색·필터

| 결정 | 이유 (한 줄 설명) |
|---|---|
| `GET /api/transactions`, `GET /api/summary`에 선택 쿼리 `q`(메모 검색어)를 더하고 `type`만 단독으로 보내는 것을 허용한다 | 새 API 없이 기존 정렬·월 범위·합계 규칙을 재사용하고, 쿼리를 안 보내는 기존 호출은 그대로 동작한다. |
| `category`는 `type`이 있을 때만 받는다 | 같은 이름이 지출·수입에 모두 있을 수 있다(v0.6 규칙 유지). |
| 메모 검색은 `memo LIKE '%' \|\| ? \|\| '%' ESCAPE '\'`로 하고 `%`, `_`, `\`는 이스케이프한다 | 사용자가 입력한 특수 문자가 와일드카드로 해석되지 않게 한다. SQLite `LIKE`는 영문 대소문자를 구분하지 않는다. |
| 인덱스는 추가하지 않는다 | 한 달 범위로 먼저 줄인 뒤 메모를 비교하므로 거래 수가 적다. |

- v0.6에서 422였던 "`type`만 보낸 요청"은 v0.9부터 200(유형 필터)이 된다. 관련 테스트(`API-FLT-E01`의 type-only)를 함께 바꾼다.

### 14.4 v0.10 분류별 월 예산

| 결정 | 이유 (한 줄 설명) |
|---|---|
| 새 테이블 `budgets(category_id, amount)` 하나를 둔다 | 분류 1개당 예산 1개이고, 모든 달에 같은 금액을 쓰므로 월 컬럼이 필요 없다. |
| 분류는 이름이 아니라 `categories.id`로 연결한다 | 분류 이름을 바꿔도 예산 테이블을 고칠 필요가 없다. (제안된 `budgets(category, amount)`에서 `category`를 id로 바꾼 것) |
| 분류를 삭제할 때 같은 트랜잭션에서 예산도 지운다 | 지워진 분류의 예산이 남지 않는다. |
| 수입 분류에 예산을 거는 요청은 서버 코드에서 거절한다 | 예산은 지출 관리용이다. |
| `GET /api/summary/categories` 항목에 `budget`, `remaining`을 더하고, 예산이 있는 분류는 지출이 0이어도 넣는다 | v0.8 화면에 사용률만 얹으면 된다. |
| 테이블은 `init_db()`의 `CREATE TABLE IF NOT EXISTS`로 만든다 | 이전 버전의 `budget.db`를 그대로 쓸 수 있다. |

### 14.5 v0.11 고정 거래

| 결정 | 이유 (한 줄 설명) |
|---|---|
| 고정 거래 틀은 `recurring_transactions` 테이블에 둔다 | 날·유형·금액·분류·메모를 저장해 두고 달마다 거래로 복사한다. |
| 틀의 분류는 `categories.id`로 연결한다 | 분류 이름을 바꿔도 틀이 따라간다. |
| 불러온 기록을 `recurring_applied(recurring_id, year_month)` 테이블에 `UNIQUE`로 남긴다 | 같은 틀이 같은 달에 두 번 들어가는 것을 DB가 막는다. 불러온 거래를 지워도 다시 생기지 않는다. `transactions` 테이블은 바꾸지 않는다. |
| 불러오기는 `POST /api/recurring/apply` 한 번에 한 트랜잭션으로 처리한다 | 거래 추가와 기록 추가가 함께 성공하거나 함께 취소되어 반쯤 들어가는 일이 없다. |
| 날짜는 `min(틀의 날, 그 달 말일)` | 31일 틀도 2월·4월에 들어갈 수 있다. |
| 자동 스케줄러는 만들지 않는다 | 서버가 꺼져 있던 달의 처리, 중복 실행 같은 문제가 생기지 않는다. |
| 분류 삭제 검사에 고정 거래 건수를 더한다 | 틀이 가리키는 분류가 사라지지 않게 한다. |
| 틀을 삭제하면 그 틀의 불러온 기록도 함께 지운다 (이미 만든 거래는 그대로) | 기록 테이블에 주인 없는 행이 남지 않는다. |
