# 데이터 모델 초안 - 개인 가계부

> 기준 문서: `docs/PRD.md` (보조: `docs/SPEC.md`, `docs/TRD.md`)
> 대상 범위: MVP(v0.1 ~ v0.3)

## 1. 개요

- 데이터베이스: SQLite, 파일 `budget.db` (서버 컴퓨터)
- 테이블: **`transactions` 1개**
- 분류는 MVP에서 고정 목록이므로 테이블을 만들지 않고 코드 상수로 관리한다. (PRD F-02)
- 월별 요약(수입 합계, 지출 합계, 잔액)은 저장하지 않고 조회할 때마다 `transactions`에서 계산한다.

## 2. 테이블: `transactions`

거래 내역 1건을 1행으로 저장한다.

| 필드 | SQLite 타입 | 제약조건 | 설명 |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 거래 내역 식별자. 서버가 자동 부여한다. |
| `date` | `TEXT` | `NOT NULL`, `YYYY-MM-DD` 형식 | 거래가 발생한 날짜. 예: `2026-10-30` |
| `type` | `TEXT` | `NOT NULL`, `CHECK (type IN ('income', 'expense'))` | 거래 유형. `income`=수입, `expense`=지출 |
| `amount` | `INTEGER` | `NOT NULL`, `CHECK (amount >= 1)`, 9,007,199,254,740,991 이하 (서버 코드에서 검사) | 원 단위 금액. 항상 양의 정수로 저장하고, 수입·지출 구분은 `type`으로 한다. 최대값은 브라우저 JavaScript가 정확히 다룰 수 있는 가장 큰 정수다. |
| `category` | `TEXT` | `NOT NULL`, `type`에 해당하는 고정 분류 중 하나 (서버 코드에서 검사) | 거래 분류 문자열. 예: `식비` |
| `memo` | `TEXT` | `NULL` 허용 | 선택 메모. 빈 값은 `NULL`로 저장한다. |
| `created_at` | `TEXT` | `NOT NULL`, ISO 8601 형식 | 서버가 등록 시 자동 기록하는 시각. 사용자가 입력·수정할 수 없다. 예: `2026-10-30T12:34:56.123456` |

### 2.1 인덱스

| 이름 | 대상 | 이유 |
|---|---|---|
| `idx_transactions_date` | `date` | 월별 조회와 거래일 정렬을 빠르게 하기 위해 |

### 2.2 정렬 규칙

목록은 항상 다음 순서로 정렬한다. (PRD F-04)

```sql
ORDER BY date DESC, created_at DESC, id DESC
```

### 2.3 DDL

```sql
CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount      INTEGER NOT NULL CHECK (amount >= 1),
    category    TEXT    NOT NULL,
    memo        TEXT,
    created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
```

## 3. 고정 분류 (테이블 아님)

| 거래 유형 | 분류 |
|---|---|
| `expense` (지출) | 식비, 교통, 주거, 쇼핑, 의료, 문화·여가, 기타 |
| `income` (수입) | 월급, 용돈, 기타 |

- `category` 값은 위 문자열을 그대로 저장한다.
- `기타`는 두 유형에 모두 있으므로, 분류만으로 유형을 판단하지 않고 항상 `type`과 함께 해석한다.
- v0.4(사용자 분류 편집)에서 필요하면 분류 테이블로 확장한다.

## 4. 계산 값: 월별 요약 (저장하지 않음)

| 항목 | 계산 방법 |
|---|---|
| `income` | 선택한 월의 `type = 'income'`인 `amount` 합계, 없으면 0 |
| `expense` | 선택한 월의 `type = 'expense'`인 `amount` 합계, 없으면 0 |
| `balance` | `income - expense` (음수 가능) |

선택한 월의 범위는 `date BETWEEN 'YYYY-MM-01' AND 'YYYY-MM-말일'`로 정한다. 날짜를 `YYYY-MM-DD` 문자열로 저장하므로 문자열 비교로 정확히 걸러진다.

## 5. TypeScript 타입 예시

> 프로젝트 프런트엔드는 순수 JavaScript를 사용한다. 아래 타입은 API로 주고받는 데이터의 모양을 보여 주기 위한 참고용 예시다.

```ts
/** 거래 유형 */
type TransactionType = "income" | "expense";

/** 고정 분류 */
type ExpenseCategory = "식비" | "교통" | "주거" | "쇼핑" | "의료" | "문화·여가" | "기타";
type IncomeCategory = "월급" | "용돈" | "기타";

/** 날짜 문자열: "YYYY-MM-DD" */
type DateString = string;

/** 시각 문자열: ISO 8601, 예) "2026-10-30T12:34:56.123456" */
type DateTimeString = string;

/** 유형과 분류의 짝이 맞도록 묶은 타입 */
type TypedCategory =
  | { type: "expense"; category: ExpenseCategory }
  | { type: "income"; category: IncomeCategory };

/** 저장된 거래 내역 (transactions 테이블 1행, API 응답) */
type Transaction = TypedCategory & {
  id: number;
  date: DateString;
  amount: number;            // 1 ~ 9,007,199,254,740,991 정수 (원)
  memo: string | null;
  created_at: DateTimeString; // 서버가 기록
};

/** 등록·수정 요청 본문 (id, created_at은 보내지 않음) */
type TransactionInput = TypedCategory & {
  date: DateString;
  amount: number;            // 1 ~ 9,007,199,254,740,991 정수 (원)
  memo?: string | null;
};

/** 월별 요약 (계산 값, API 응답) */
type MonthlySummary = {
  year: number;
  month: number;             // 1 ~ 12
  income: number;
  expense: number;
  balance: number;           // income - expense
};
```

### 예시 값

```ts
const lunch: Transaction = {
  id: 7,
  date: "2026-10-30",
  type: "expense",
  amount: 12500,
  category: "식비",
  memo: "점심",
  created_at: "2026-10-30T12:34:56.123456",
};

const october: MonthlySummary = {
  year: 2026,
  month: 10,
  income: 3000000,
  expense: 12500,
  balance: 2987500,
};
```
