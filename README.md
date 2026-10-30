# budget_book

혼자 사용하는 간단한 가계부 웹 앱입니다. 로그인 없이 브라우저에서 수입과 지출을 기록하고, 월별 수입 합계·지출 합계·잔액을 확인합니다. 거래 데이터는 서버를 실행하는 컴퓨터의 SQLite 파일 `budget.db`에 저장됩니다.

## 현재 상태

- MVP(v0.1 ~ v0.3) 기능이 구현되어 있습니다: 거래 등록·조회·수정·삭제, 고정 분류, 월별 요약.
- API 테스트 140개와 샘플 테스트 1개가 모두 통과합니다.
- 화면 동작(`docs/TEST_CASES.md` 2장)은 브라우저에서 직접 확인합니다.

## MVP 기능

- 수입·지출 거래 등록, 조회, 수정, 삭제
- 거래 항목: 거래일, 유형(수입/지출), 금액, 분류, 메모(선택)
- 고정 분류 목록
  - 지출: 식비, 교통, 주거, 쇼핑, 의료, 문화·여가, 기타
  - 수입: 월급, 용돈, 기타
- 연·월을 선택해 해당 월의 거래 목록 조회 (거래일 → 등록 시각 → ID 내림차순)
- 월별 요약: 수입 합계, 지출 합계, 잔액(수입 합계 - 지출 합계)
- 금액은 원 단위 정수로 저장하고 `12,500원` 형식으로 표시
- 삭제 전 확인 창 표시, 삭제한 거래는 복구 불가

## 기술 스택

| 구분 | 기술 |
|---|---|
| 백엔드 | Python 3.12, FastAPI, Uvicorn, Pydantic |
| 데이터베이스 | SQLite (`budget.db`), Python 표준 `sqlite3` 모듈 |
| 프런트엔드 | HTML + CSS + 순수 JavaScript |
| 테스트 | pytest, httpx (FastAPI `TestClient`) |

## 폴더 구조

```
budget_book/
├─ app/
│  ├─ main.py         FastAPI 앱, API 경로, 에러 처리
│  ├─ db.py           SQLite 연결, 테이블 생성
│  ├─ schemas.py      요청 본문 검증
│  └─ categories.py   고정 분류 목록
├─ static/
│  ├─ index.html      화면
│  ├─ app.js          화면 동작, API 호출
│  └─ style.css       스타일
├─ tests/
│  ├─ test_api.py     API 테스트
│  └─ test_sample.py  샘플 테스트
├─ docs/              기획 문서
├─ requirements.txt   의존성
├─ CLAUDE.md          작업 규칙
└─ README.md
```

## 문서

| 문서 | 내용 |
|---|---|
| [docs/IDEA.md](docs/IDEA.md) | 아이디어와 버전 로드맵 |
| [docs/SPEC.md](docs/SPEC.md) | 기능 명세 |
| [docs/PRD.md](docs/PRD.md) | 제품 요구사항 |
| [docs/TRD.md](docs/TRD.md) | 기술 요구사항, 기술 선택 이유, 저장 흐름 |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | 테이블 구조와 TypeScript 타입 예시 |
| [docs/API_SPEC.md](docs/API_SPEC.md) | API 엔드포인트, 요청/응답, 에러 코드 |
| [docs/COMPONENT_SPEC.md](docs/COMPONENT_SPEC.md) | 화면 컴포넌트, 사용자 동작, 상태별 문구 |
| [docs/TEST_CASES.md](docs/TEST_CASES.md) | API·컴포넌트 테스트 케이스 |

## 설치와 실행 (Windows PowerShell 기준)

Python 3.12가 필요합니다.

```powershell
# 가상환경 만들기
python -m venv .venv

# 의존성 설치
.venv\Scripts\python -m pip install -r requirements.txt

# 서버 실행 후 브라우저에서 http://127.0.0.1:8000 접속
.venv\Scripts\python -m uvicorn app.main:app --reload

# 테스트 실행
.venv\Scripts\python -m pytest tests
```

- 처음 실행하면 프로젝트 폴더에 `budget.db`가 자동으로 만들어집니다.
- API 문서는 http://127.0.0.1:8000/docs 에서 볼 수 있습니다. 에러 응답은 이 화면의 예시와 달리 `docs/API_SPEC.md`의 `{ "error": { "code", "message" } }` 형식을 따릅니다.
- 테스트는 임시 DB 파일을 사용하므로 `budget.db`를 건드리지 않습니다.
- 로그인 기능이 없으므로 서버를 외부에 공개하지 마세요. 기본 설정(`127.0.0.1`)은 내 컴퓨터에서만 접속할 수 있습니다.

## 데이터 백업

MVP에는 앱 안에서 백업하는 기능이 없습니다. (v0.5에서 추가 예정)

- 백업: 서버를 끈 상태에서 프로젝트 폴더의 `budget.db` 파일을 다른 곳에 복사합니다.
- 복원 또는 다른 컴퓨터에서 사용: 복사해 둔 `budget.db`를 프로젝트 폴더에 넣고 서버를 실행합니다.
- `budget.db`는 개인 거래 데이터이므로 git에 올리지 않습니다. (`.gitignore`에 포함)

## 범위 밖

회원가입·로그인·여러 사용자, 기기 간 동기화·온라인 백업, 예산·반복 거래·알림, 영수증 자동 분류, 은행 연동, 통계 차트, 파일 내보내기, 삭제한 거래 복구는 지원하지 않습니다. 사용자 분류 추가·수정·삭제는 v0.4, 앱 내 DB 백업은 v0.5에서 추가할 예정입니다.

## 버전 로드맵

| 버전 | 내용 |
|---|---|
| v0.1 | FastAPI와 SQLite 연결, 기본 화면 |
| v0.2 | 거래 등록·조회·수정·삭제, 입력 검증, 확인 삭제, 정렬 |
| v0.3 | 월별 요약, 월별 조회, 빈 상태 |
| v0.4 | 사용자 분류 추가·이름 수정·삭제 (기본 분류는 고정) |
| v0.5 | 앱 내 데이터베이스 백업 |
| v1.0 | 안정화 및 첫 정식 버전 |
