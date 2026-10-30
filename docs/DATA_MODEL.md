# 데이터 모델 초안 - 개인 가계부

> 기준 문서: `docs/PRD.md` (보조: `docs/SPEC.md`, `docs/TRD.md`)
> 대상 범위: MVP(v0.1 ~ v0.3), v0.4 사용자 분류 편집(6절)

## 1. 개요

- 데이터베이스: SQLite, 파일 `budget.db` (서버 컴퓨터)
- 테이블: MVP는 **`transactions` 1개**, v0.4부터 **`categories`를 더해 2개**
- 분류는 MVP에서 고정 목록이므로 테이블을 만들지 않고 코드 상수로 관리한다. (PRD F-02) v0.4부터는 `categories` 테이블에 저장한다. (6절)
- 월별 요약(수입 합계, 지출 합계, 잔액)은 저장하지 않고 조회할 때마다 `transactions`에서 계산한다.

## 2. 테이블: `transactions`

거래 내역 1건을 1행으로 저장한다.

| 필드 | SQLite 타입 | 제약조건 | 설명 |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 거래 내역 식별자. 서버가 자동 부여한다. |
| `date` | `TEXT` | `NOT NULL`, `YYYY-MM-DD` 형식 | 거래가 발생한 날짜. 예: `2026-10-30` |
| `type` | `TEXT` | `NOT NULL`, `CHECK (type IN ('income', 'expense'))` | 거래 유형. `income`=수입, `expense`=지출 |
| `amount` | `INTEGER` | `NOT NULL`, `CHECK (amount >= 1)`, 9,007,199,254,740,991 이하 (서버 코드에서 검사) | 원 단위 금액. 항상 양의 정수로 저장하고, 수입·지출 구분은 `type`으로 한다. 최대값은 브라우저 JavaScript가 정확히 다룰 수 있는 가장 큰 정수다. |
| `category` | `TEXT` | `NOT NULL`, `type`에 해당하는 고정 분류 중 하나 (서버 코드에서 검사). v0.4부터는 `categories`에 같은 `(type, name)`이 있어야 함 | 거래 분류 문자열. 예: `식비` |
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
- v0.4부터 위 분류는 `categories` 테이블의 기본 분류(`is_default = 1`)로 저장한다. (6절)

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

## 6. v0.4: 테이블 `categories`

> 요구사항: SPEC FR-8, PRD F-10 / 설계 이유: TRD 11절

분류 1개를 1행으로 저장한다. 기본 분류와 사용자 분류를 같은 테이블에 둔다.

| 필드 | SQLite 타입 | 제약조건 | 설명 |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 분류 식별자. 서버가 자동 부여한다. |
| `type` | `TEXT` | `NOT NULL`, `CHECK (type IN ('income', 'expense'))` | 이 분류를 쓰는 거래 유형. 만든 뒤에는 바꿀 수 없다. |
| `name` | `TEXT` | `NOT NULL`, `CHECK (length(trim(name)) BETWEEN 1 AND 20)`, `UNIQUE (type, name)` | 분류 이름. 앞뒤 공백을 제거해 1~20자로 저장한다. 같은 유형 안에서 유일하다. |
| `is_default` | `INTEGER` | `NOT NULL`, `DEFAULT 0`, `CHECK (is_default IN (0, 1))` | `1`이면 기본 분류. 기본 분류는 이름 수정·삭제할 수 없다. |

### 6.1 제약과 정렬

- `UNIQUE (type, name)`: 같은 유형 안에서 이름 중복을 DB가 막는다. 기본 분류 이름도 포함된다. 유형이 다르면 같은 이름을 쓸 수 있다.
- 목록 순서: `ORDER BY is_default DESC, id` → 기본 분류가 먼저(3절 순서), 그다음 사용자 분류가 추가한 순서로 나온다.

### 6.2 `transactions`와의 관계

- 외래 키 없이 `transactions.(type, category)` = `categories.(type, name)`으로 연결한다. (이유: TRD 11.1)
- **이름 수정**: `categories.name`을 바꿀 때 같은 트랜잭션에서 `transactions`의 `(type, 옛 이름)` 행을 모두 새 이름으로 바꾼다.
- **삭제**: `transactions`에 `(type, name)` 행이 1개 이상이면 삭제하지 않는다.
- 위 두 규칙 덕분에 모든 거래의 `(type, category)`는 항상 `categories`에 존재한다.

### 6.3 DDL과 초기 데이터

```sql
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    name        TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 20),
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    UNIQUE (type, name)
);

-- 서버 시작 시 실행. 이미 있으면 건너뛴다.
INSERT OR IGNORE INTO categories (type, name, is_default) VALUES
    ('expense', '식비', 1), ('expense', '교통', 1), ('expense', '주거', 1),
    ('expense', '쇼핑', 1), ('expense', '의료', 1), ('expense', '문화·여가', 1),
    ('expense', '기타', 1),
    ('income', '월급', 1), ('income', '용돈', 1), ('income', '기타', 1);
```

- MVP에서 만든 `budget.db`도 서버를 다시 시작하면 이 테이블과 기본 분류가 추가된다. `transactions`는 바뀌지 않는다.

### 6.4 TypeScript 타입 예시 (v0.4)

```ts
/** 분류 1개 (categories 테이블 1행, API 응답) */
type Category = {
  id: number;
  type: TransactionType;
  name: string;              // 1 ~ 20자
  is_default: boolean;       // DB의 0/1을 API에서는 true/false로 보낸다
};

/** 유형별 분류 목록 (GET /api/categories 응답) */
type CategoriesByType = {
  expense: Category[];
  income: Category[];
};

/** 분류 추가 요청 본문 */
type CategoryInput = {
  type: TransactionType;
  name: string;
};

/** 분류 이름 수정 요청 본문 (유형은 바꿀 수 없음) */
type CategoryRename = {
  name: string;
};
```

- v0.4부터 분류 이름이 고정 목록이 아니므로, 5절의 `ExpenseCategory`·`IncomeCategory`·`TypedCategory`는 `category: string`으로 바뀐다. 유형과 분류가 맞는지는 서버가 검사한다.

```ts
const myCategory: Category = { id: 11, type: "income", name: "부업", is_default: false };
```

- 분류 이름 길이는 앞뒤 공백을 제거한 뒤의 글자 수(유니코드 문자 수)로 센다. 최대 20자는 목록과 선택 상자 표시가 깨지지 않도록 정한 값이다.
