# 컴포넌트 명세 초안 - 개인 가계부

> 기준 문서: `docs/PRD.md`, `docs/API_SPEC.md` (보조: `docs/DATA_MODEL.md`, `docs/TRD.md`)
> 대상 범위: MVP(v0.1 ~ v0.3), v0.4 사용자 분류 편집(4.8 ~ 4.9절), v0.5 백업(4.10절), v0.6 분류 필터(4.5절), v0.7 ~ v0.11(4.11 ~ 4.16절)

## 1. 개요

- 화면은 한 페이지(`static/index.html`)이고, 화면 조각(컴포넌트)은 `static/app.js`의 **순수 JavaScript 함수**로 만든다. React 같은 프레임워크는 쓰지 않는다.
- 각 컴포넌트는 "Props 객체를 받아 DOM 요소를 그리는 함수"다. 예: `renderSummaryPanel(container, props)`
- 데이터와 상태는 최상위 `App`이 한곳에서 갖고, 하위 컴포넌트에는 Props로 내려 준다. 하위 컴포넌트는 사용자 동작을 콜백(`on...`)으로 `App`에 알린다.
- Props 타입은 TypeScript 문법으로 적었지만 **설명용**이다. 공통 타입(`Transaction`, `TransactionInput`, `MonthlySummary`, `TransactionType`)은 `DATA_MODEL.md` 5절을 따른다.

## 2. 컴포넌트 트리

```
App
├─ BackupButton           (v0.5) 상단 제목 옆 백업 다운로드 버튼
├─ MonthSelector          연·월 선택
├─ MonthNavigator         (v0.7) 이전 달·다음 달·이번 달 버튼 (월 선택 옆)
├─ SummaryPanel           선택한 월의 수입·지출 합계, 잔액
├─ CategorySpending       (v0.8) 분류별 지출 막대 목록 (v0.10: 예산 사용률·남은 금액)
├─ TransactionForm        거래 등록·수정 폼 (유형, 거래일, 금액, 분류, 메모)
├─ CategoryManager        (v0.4) 분류 관리 카드: 유형별 분류 목록, 분류 추가
│  └─ CategoryItem        (v0.4) 분류 1개 (사용자 분류만 수정·삭제 버튼, v0.10: 지출 분류 예산)
├─ RecurringManager       (v0.11) 고정 거래 카드: 목록, 추가·수정·삭제
│  └─ RecurringItem       (v0.11) 고정 거래 1개
└─ TransactionList        선택한 월의 거래 목록
   ├─ TransactionFilters  (v0.9) 유형·분류·검색어 조건 (v0.6 분류 필터 선택 상자를 대체)
   ├─ RecurringApplyButton (v0.11) 이번 달 고정 거래 불러오기
   └─ TransactionItem     거래 1건 (수정·삭제 버튼)

StatusMessage             로딩·빈 목록·에러 문구 (SummaryPanel, TransactionForm, CategoryManager, TransactionList 안에서 사용)
```

## 3. 공통 타입

```ts
/** 선택한 연·월 */
type YearMonth = { year: number; month: number }; // month: 1 ~ 12

/** 분류 목록 (GET /api/categories 응답). v0.4부터 DATA_MODEL 6.4절의 Category 객체 배열 */
type Categories = { expense: Category[]; income: Category[] };

/** 서버 에러 (API_SPEC 1.2절) */
type ApiError = { code: string; message: string };

/** 비동기로 불러오는 데이터의 상태 */
type AsyncState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError };
```

## 4. 컴포넌트별 명세

### 4.1 `App`

전체 상태를 갖고 API를 호출한다. Props는 없다.

**가지고 있는 상태**

| 상태 | 타입 | 초기값 |
|---|---|---|
| `selected` | `YearMonth` | 오늘이 속한 연·월 |
| `categories` | `AsyncState<Categories>` | `loading` |
| `transactions` | `AsyncState<Transaction[]>` | `loading` |
| `summary` | `AsyncState<MonthlySummary>` | `loading` |
| `editing` | `Transaction \| null` | `null` (등록 모드) |
| `submitting` | `boolean` | `false` |
| `formError` | `ApiError \| null` | `null` |
| `deletingId` | `number \| null` | `null` |
| `formResetKey` | `number` | `0` (폼을 새로 채울 때마다 1 증가: 저장 성공, 수정 시작, 수정 취소, 수정 중인 거래 삭제) |
| `categoryBusy` | `boolean` | `false` (v0.4, 분류 추가·수정·삭제 요청 중) |
| `categoryError` | `ApiError \| null` | `null` (v0.4) |
| `renamingCategoryId` | `number \| null` | `null` (v0.4, 이름 수정 중인 분류) |
| `categoryResetKey` | `number` | `0` (v0.4, 분류 추가 성공 시 1 증가 → 추가 입력칸 비움) |
| `backingUp` | `boolean` | `false` (v0.5, 백업 요청 중) |
| `filter` | `{ type: TransactionType; category: string } \| null` | `null` (v0.6, `null`이면 전체) |
| `filterSummary` | `AsyncState<MonthlySummary> \| null` | `null` (v0.6, 필터가 있을 때만 그 분류의 합계) |
| `categorySpending` | `AsyncState<CategorySpendingSummary>` | `loading` (v0.8) |
| `filters` | `{ type: TransactionType \| null; category: string \| null; q: string \| null }` | 모두 `null` (v0.9, v0.6 `filter`를 대체) |
| `budgets` | `AsyncState<Budget[]>` | `loading` (v0.10) |
| `budgetEditingId` | `number \| null` | `null` (v0.10, 예산 입력 중인 분류) |
| `recurring` | `AsyncState<RecurringTransaction[]>` | `loading` (v0.11, 선택한 달 기준 `applied` 포함) |
| `recurringEditing` | `RecurringTransaction \| null` | `null` (v0.11) |
| `recurringBusy` | `boolean` | `false` (v0.11, 추가·수정·삭제 요청 중) |
| `recurringError` | `ApiError \| null` | `null` (v0.11) |
| `applyingRecurring` | `boolean` | `false` (v0.11, 불러오기 요청 중) |

**하는 일**

| 시점 | 동작 |
|---|---|
| 처음 열 때 | `GET /api/categories`, 그리고 `selected` 기준으로 `GET /api/transactions`, `GET /api/summary` 호출 |
| 월 변경 | `selected` 변경 → 목록·요약 다시 조회 |
| 등록·수정·삭제 성공 | 목록·요약 다시 조회 |
| (v0.4) 분류 추가·삭제 성공 | 분류 목록 다시 조회 |
| (v0.4) 분류 이름 수정 성공 | 분류 목록과 거래 목록 다시 조회 (거래에 표시되는 분류 이름이 바뀌므로) |

### 4.2 `MonthSelector`

```ts
type MonthSelectorProps = {
  value: YearMonth;
  disabled: boolean;                       // 저장 중일 때 true
  onChange: (value: YearMonth) => void;
};
```

- `<input type="month">`로 표시한다.

| 사용자 동작 | 결과 |
|---|---|
| 다른 연·월 선택 | `onChange` 호출 → `App`이 목록·요약을 다시 조회하고, 그동안 두 영역에 로딩 문구 표시 |
| 값을 지움 | 무시하고 이전 연·월을 유지 |

### 4.3 `SummaryPanel`

```ts
type SummaryPanelProps = {
  summary: AsyncState<MonthlySummary>;
  onRetry: () => void;
};
```

- 수입 합계(파란색), 지출 합계(빨간색), 잔액을 `12,500원` 형식으로 표시한다.
- 해당 월에 내역이 없으면 서버가 0을 돌려주므로 `0원`으로 표시한다. (별도 빈 상태 문구 없음)

| 사용자 동작 | 결과 |
|---|---|
| 에러 상태에서 `다시 시도` 클릭 | `onRetry` 호출 → `GET /api/summary` 다시 호출 |

### 4.4 `TransactionForm`

```ts
type TransactionFormProps = {
  categories: AsyncState<Categories>;
  editing: Transaction | null;             // null이면 등록 모드, 값이 있으면 수정 모드
  submitting: boolean;
  error: ApiError | null;                  // 클라이언트 검사 또는 서버 에러
  resetKey: number;                        // 값이 바뀔 때만 입력값을 기본값 또는 editing 값으로 다시 채움
  onSubmit: (input: TransactionInput) => void;
  onCancelEdit: () => void;
  onRetryCategories: () => void;
};
```

- 입력 중인 값은 폼이 직접 가지고 있다. 목록·요약을 다시 불러와도 `resetKey`가 그대로면 입력값과 커서 위치를 유지한다.

**입력 항목**

| 항목 | 입력 방식 | 기본값 (등록 모드) |
|---|---|---|
| 유형 | 라디오 버튼: 지출 / 수입 | 지출 |
| 거래일 | `<input type="date">` | 오늘 |
| 금액 | `<input type="number" min="1" step="1">` | 빈 값 |
| 분류 | `<select>`, 선택한 유형의 분류만 표시 | `분류 선택` (선택 안 됨) |
| 메모 | `<input type="text">`, 선택 | 빈 값 |

**모드별 표시**

| 모드 | 제목 | 버튼 |
|---|---|---|
| 등록 | `거래 등록` | `저장` |
| 수정 | `거래 수정` | `수정 저장`, `취소` |

**사용자 동작과 결과**

| 사용자 동작 | 결과 |
|---|---|
| 유형 변경 | 분류 목록을 해당 유형 목록으로 바꾸고 분류 선택을 `분류 선택`으로 초기화 |
| `저장` 클릭 (입력 정상) | 버튼 비활성화·문구 `저장 중...` → `POST /api/transactions` → 성공 시 폼을 등록 모드 기본값으로 초기화, 목록·요약 갱신 |
| `수정 저장` 클릭 (입력 정상) | 버튼 비활성화·문구 `저장 중...` → `PUT /api/transactions/{id}` → 성공 시 등록 모드로 돌아가고 목록·요약 갱신 |
| 저장한 거래의 거래일이 선택한 월과 다름 | 성공 후 `selected`를 그 거래의 연·월로 바꿔, 저장한 내역이 바로 보이게 한다 |
| 저장 클릭 (입력 오류) | 요청을 보내지 않고 폼 위에 에러 문구 표시 |
| 서버가 에러 응답 | 입력값은 그대로 두고 폼 위에 서버 `message` 표시, 버튼 다시 활성화 |
| 수정 저장 시 서버가 404 `TRANSACTION_NOT_FOUND` 응답 | 폼 위에 서버 `message` 표시 후 목록·요약 다시 조회 |
| 수정 모드에서 `취소` 클릭 | `onCancelEdit` 호출 → 등록 모드로 돌아가고 입력값 초기화 |
| 분류 불러오기 실패 상태에서 `다시 시도` 클릭 | `onRetryCategories` 호출 → `GET /api/categories` 다시 호출 |

**클라이언트 검사 문구** (서버 `message`와 같게 맞춘다)

| 상황 | 문구 |
|---|---|
| 거래일 없음 | `거래일을 입력해 주세요.` |
| 금액 없음 | `금액을 입력해 주세요.` |
| 금액이 정수가 아니거나 1 미만 | `금액은 1 이상의 정수여야 합니다.` |
| 분류 선택 안 함 | `분류를 선택해 주세요.` |

### 4.5 `TransactionList`

```ts
type TransactionListProps = {
  transactions: AsyncState<Transaction[]>;
  selected: YearMonth;
  editingId: number | null;
  deletingId: number | null;
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
  onRetry: () => void;
  // v0.6 분류 필터
  categories: AsyncState<Categories>;
  filter: { type: TransactionType; category: string } | null;
  filterSummary: AsyncState<MonthlySummary> | null;
  onFilterChange: (filter: { type: TransactionType; category: string } | null) => void;
};
```

- 서버가 정렬해서 준 순서(거래일 → 등록 시각 → ID 내림차순) 그대로 표시한다.
- (v0.6) 제목 아래에 `분류 필터` 선택 상자를 둔다: `전체 분류`, `지출` 묶음(지출 분류들), `수입` 묶음(수입 분류들). 분류를 아직 못 불러왔으면 `전체 분류`만 있다.
- (v0.6) 필터가 있으면 선택 상자 아래에 `식비(지출) · 3건 · 합계 62,500원` 한 줄을 보여 준다. 건수는 목록의 거래 수, 합계는 `filterSummary`의 해당 유형 합계다. 합계를 불러오는 중이면 `합계 계산 중...`, 실패하면 에러 문구를 보여 준다.

| 사용자 동작 (v0.6) | 결과 |
|---|---|
| 필터에서 분류 선택 | `onFilterChange` → 그 분류의 목록과 합계를 다시 조회 |
| 필터를 `전체 분류`로 변경 | 필터 해제 → 전체 목록 다시 조회, 건수·합계 줄 숨김 |
| 필터 상태에서 월 변경 | 필터 유지, 새 달의 그 분류 목록과 합계 조회 |
| 필터 상태에서 거래 등록·수정·삭제 성공 | 목록과 합계 다시 조회 |
| 필터의 분류 이름을 분류 관리에서 수정 | 필터가 새 이름으로 바뀌고 목록·합계 다시 조회 |
| 분류 목록을 다시 불러왔는데 필터의 분류가 없음 | 필터를 `전체 분류`로 되돌리고 목록 다시 조회 |

| 사용자 동작 | 결과 |
|---|---|
| 에러 상태에서 `다시 시도` 클릭 | `onRetry` 호출 → `GET /api/transactions` 다시 호출 |

### 4.6 `TransactionItem`

```ts
type TransactionItemProps = {
  transaction: Transaction;
  isEditing: boolean;                      // 지금 폼에서 수정 중인 거래면 강조 표시
  isDeleting: boolean;                     // 삭제 요청 중이면 버튼 비활성화
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
};
```

- 거래일, 유형, 분류, 금액, 메모를 표시한다.
- 금액은 `12,500원` 형식이고 지출은 빨간색, 수입은 파란색이다.
- 메모가 `null`이면 메모 칸을 비워 둔다.

| 사용자 동작 | 결과 |
|---|---|
| `수정` 클릭 | `onEdit` 호출 → 폼이 수정 모드가 되고 이 거래의 값으로 채워짐 |
| `삭제` 클릭 | 확인 창 `2026-10-30 식비 12,500원 내역을 삭제할까요?` 표시 |
| 확인 창에서 `확인` | 버튼 비활성화 → `DELETE /api/transactions/{id}` → 성공 시 목록·요약 갱신. 수정 중이던 거래였다면 폼을 등록 모드로 되돌림 |
| 확인 창에서 `취소` | 아무 요청도 보내지 않음 |
| 삭제 실패 | `alert`로 서버 `message` 표시. 404면 목록·요약 다시 조회 |

### 4.7 `StatusMessage`

```ts
type StatusMessageProps = {
  kind: "loading" | "empty" | "error";
  message: string;
  onRetry?: () => void;                    // 있으면 `다시 시도` 버튼 표시
};
```

### 4.8 `CategoryManager` (v0.4)

입력 폼 아래의 별도 카드다. 제목은 `분류 관리`.

```ts
type CategoryManagerProps = {
  categories: AsyncState<Categories>;
  busy: boolean;                           // 추가·수정·삭제 요청 중이면 true
  error: ApiError | null;                  // 클라이언트 검사 또는 서버 에러
  renamingId: number | null;               // 이름 수정 중인 분류
  resetKey: number;                        // 바뀔 때만 추가 입력칸을 비움 (추가 성공 시)
  onAdd: (input: CategoryInput) => void;
  onStartRename: (category: Category) => void;
  onRename: (category: Category, name: string) => void;
  onCancelRename: () => void;
  onDelete: (category: Category) => void;
  onRetry: () => void;
};
```

- 지출 분류와 수입 분류를 나눠 목록으로 보여 준다. 순서는 서버 응답 순서(기본 분류 → 추가한 순서)다.
- 아래에 분류 추가 입력이 있다: 유형(라디오: 지출 / 수입, 기본값 지출), 이름(`<input type="text">`), `추가` 버튼.
- 입력 폼(4.4)의 분류 선택에는 각 분류의 `name`이 표시된다.

| 사용자 동작 | 결과 |
|---|---|
| 유형·이름을 입력하고 `추가` 클릭 (입력 정상) | 버튼 비활성화·문구 `추가 중...` → `POST /api/categories` → 성공 시 이름 입력칸을 비우고 분류 목록 다시 조회 (입력 폼 분류 선택에도 나타남) |
| `추가` 클릭 (입력 오류) | 요청을 보내지 않고 카드 위쪽에 에러 문구 표시 |
| 사용자 분류의 `수정` 클릭 | `onStartRename` → 그 분류 자리가 이름 입력칸(현재 이름이 채워짐)과 `저장`, `취소` 버튼으로 바뀜 |
| 이름 수정 후 `저장` 클릭 (입력 정상) | `PUT /api/categories/{id}` → 성공 시 수정 모드 종료, 분류 목록과 거래 목록 다시 조회 |
| 이름 수정 중 `취소` 클릭 | 요청 없이 수정 모드 종료 |
| 사용자 분류의 `삭제` 클릭 | 확인 창 `'간식'(지출) 분류를 삭제할까요?` 표시 |
| 확인 창에서 `확인` | `DELETE /api/categories/{id}` → 성공 시 분류 목록 다시 조회 |
| 확인 창에서 `취소` | 아무 요청도 보내지 않음 |
| 서버가 에러 응답 (중복, 사용 중, 기본 분류 등) | 카드 위쪽에 서버 `message` 표시, 입력값 유지. 404면 분류 목록 다시 조회 |
| 분류 불러오기 실패 상태에서 `다시 시도` 클릭 | `onRetry` → `GET /api/categories` 다시 호출 |

**클라이언트 검사 문구** (서버 `message`와 같게 맞춘다)

| 상황 | 문구 |
|---|---|
| 이름이 비었거나 공백만 있음 | `분류 이름을 입력해 주세요.` |
| 앞뒤 공백 제거 후 20자 초과 | `분류 이름은 20자 이하여야 합니다.` |

- 같은 유형 안 이름 중복은 서버가 검사한다(`DUPLICATE_CATEGORY`).
- 추가·수정·삭제 요청 중에는 카드 안의 모든 버튼을 비활성화한다.
- 이름을 수정한 분류를 입력 폼(4.4)에서 선택해 두었다면, 분류 목록을 다시 불러온 뒤 그 선택은 `분류 선택`으로 초기화된다.

### 4.9 `CategoryItem` (v0.4)

```ts
type CategoryItemProps = {
  category: Category;
  isRenaming: boolean;
  busy: boolean;
  onStartRename: (category: Category) => void;
  onRename: (category: Category, name: string) => void;
  onCancelRename: () => void;
  onDelete: (category: Category) => void;
};
```

- 기본 분류: 이름과 `기본` 표시만 보여 주고 `수정`·`삭제` 버튼은 없다.
- 사용자 분류: 이름과 `수정`·`삭제` 버튼을 보여 준다. `isRenaming`이면 이름 입력칸과 `저장`·`취소` 버튼을 보여 준다.

### 4.10 `BackupButton` (v0.5)

화면 상단 제목(`가계부`) 바로 옆에 둔다.

```ts
type BackupButtonProps = {
  busy: boolean;                           // 백업 요청 중이면 true
  onBackup: () => void;
};
```

| 사용자 동작 | 결과 |
|---|---|
| `백업 다운로드` 클릭 | 버튼 비활성화·문구 `백업 중...` → `GET /api/backup` → 성공 시 응답의 파일 이름(`budget-backup-YYYY-MM-DD-HHMM.db`)으로 다운로드 시작, 버튼 원래대로 |
| 백업 실패 (서버 에러, 연결 실패) | `alert`로 에러 문구 표시, 버튼 다시 활성화 |
| 요청 중 다시 클릭 | 버튼이 비활성화되어 있어 요청이 한 번만 전송됨 |

- 응답에서 파일 이름을 읽지 못하면 브라우저 시각으로 같은 형식의 이름을 만든다.

### 4.11 `MonthNavigator` (v0.7)

월 선택 칸 옆에 둔다.

```ts
type MonthNavigatorProps = {
  value: YearMonth;
  today: YearMonth;
  disabled: boolean;                       // 거래 저장 중이면 true
  onChange: (value: YearMonth) => void;    // MonthSelector와 같은 onChange (handleMonthChange)
};
```

| 사용자 동작 | 결과 |
|---|---|
| `이전 달` 클릭 | 한 달 전으로 이동 (1월 → 전년 12월). 목록·요약을 다시 불러오고 필터 유지 |
| `다음 달` 클릭 | 한 달 뒤로 이동 (12월 → 다음 해 1월) |
| `이번 달` 클릭 | 오늘이 속한 달로 이동 |

- 이번 달을 보고 있으면 `이번 달` 버튼을 비활성화한다.
- 0001년 1월이면 `이전 달`, 9999년 12월이면 `다음 달`을 비활성화한다.

### 4.12 `CategorySpending` (v0.8 / v0.10 예산 표시)

월별 요약 아래 카드다. 제목은 `분류별 지출`.

```ts
type CategorySpendingProps = {
  spending: AsyncState<CategorySpendingSummary>;
  onRetry: () => void;
};
```

- 한 줄에 분류 이름, 금액(`20,500원`), 건수(`2건`), 비율(`4%`), 막대를 보여 준다. 막대 길이는 `amount ÷ total`이다.
- (v0.10) 예산이 있는 줄은 `예산 300,000원 · 7% 사용 · 279,500원 남음`을 덧붙이고, 막대 길이를 `amount ÷ budget`(최대 100%)으로 바꾼다. 초과하면 `12,000원 초과`를 빨간색으로 보여 주고 막대를 빨간색으로 채운다.
- 금액이 큰 순서는 서버 응답 순서를 그대로 따른다.
- 월 변경, 거래 등록·수정·삭제, 분류 이름 수정, (v0.10) 예산 변경 후 다시 불러온다.

### 4.13 `TransactionFilters` (v0.9)

거래 내역 카드 제목 아래에 둔다. v0.6의 `분류 필터` 선택 상자를 대체한다.

```ts
type TransactionFiltersProps = {
  categories: AsyncState<Categories>;
  filters: { type: TransactionType | null; category: string | null; q: string | null };
  onChange: (filters: TransactionFiltersProps["filters"]) => void;
};
```

- 유형 선택(`전체`, `지출`, `수입`), 분류 선택(`전체 분류` + 분류들), 검색어 입력칸과 `검색` 버튼, `필터 초기화` 버튼을 둔다.
- 유형이 `전체`면 분류 선택지는 지출·수입 묶음 전체, 유형을 고르면 그 유형의 분류만 보여 준다. 분류를 고르면 유형도 그 분류의 유형으로 맞춘다.
- 유형을 바꿔서 지금 고른 분류가 그 유형에 없으면 분류를 `전체 분류`로 되돌린다.
- 검색어는 Enter 또는 `검색` 버튼으로 적용하고, 앞뒤 공백을 제거한다. 50자를 넘으면 요청 없이 `검색어는 50자 이하여야 합니다.`를 보여 준다.
- 조건이 하나라도 있으면 아래에 결과 줄을 보여 준다: `검색 결과 · 3건 · 수입 0원 · 지출 20,500원`. 유형이 정해져 있으면 그 유형 합계만 보여 준다.
- 결과가 없으면 `조건에 맞는 거래가 없습니다.`
- `필터 초기화`는 조건이 있을 때만 활성화한다.

### 4.14 `CategoryItem` 예산 (v0.10)

- 지출 분류(기본 분류 포함) 줄에 예산이 있으면 `예산 300,000원`을 보여 주고 `예산` 버튼을 둔다. 수입 분류에는 예산 표시와 버튼이 없다.
- `예산` 버튼을 누르면 그 줄에 금액 입력칸과 `저장`, `해제`(예산이 있을 때만), `취소` 버튼이 나온다.
- 금액 검사 문구는 거래 금액과 같다(`금액을 입력해 주세요.`, `금액은 1 이상의 정수여야 합니다.`).
- 저장·해제가 성공하면 예산 목록과 분류별 지출을 다시 불러온다. 실패하면 분류 관리 카드 위쪽에 에러 문구를 보여 준다.

### 4.15 `RecurringManager` / `RecurringItem` (v0.11)

분류 관리 카드 아래의 별도 카드다. 제목은 `고정 거래`.

- 목록: `매달 1일 · 지출 · 주거 · 550,000원 · 월세`처럼 한 줄씩, 날 순서로 보여 준다. 각 줄에 `수정`, `삭제` 버튼.
- 추가 폼: 날(1~31 숫자 입력), 유형(라디오), 금액, 분류(유형에 맞는 분류), 메모, `추가` 버튼. `수정`을 누르면 같은 폼이 그 고정 거래 값으로 채워지고 `수정 저장`, `취소` 버튼이 나온다.
- 클라이언트 검사: `날은 1부터 31 사이여야 합니다.`, 금액·분류 문구는 거래 폼과 같다.
- 삭제 전 확인 창: `매달 1일 주거 550,000원 고정 거래를 삭제할까요? (이미 추가된 거래는 남습니다)`
- 고정 거래가 없으면 `등록된 고정 거래가 없습니다.`
- 29~31일 고정 거래에는 `없는 달은 말일` 안내를 덧붙인다.

### 4.16 `RecurringApplyButton` (v0.11)

거래 내역 카드의 필터 아래에 둔다.

| 상태 | 버튼 |
|---|---|
| 그 달에 불러올 고정 거래가 N건 | `이번 달 고정 거래 불러오기 (N건)` 활성 |
| 모두 불러왔음 | `고정 거래를 모두 불러왔습니다` 비활성 |
| 고정 거래가 없음 | `등록된 고정 거래 없음` 비활성 |
| 요청 중 | `불러오는 중...` 비활성 |

| 사용자 동작 | 결과 |
|---|---|
| 버튼 클릭 | 확인 창 `2026년 10월에 고정 거래 3건을 추가할까요?` |
| 확인 | `POST /api/recurring/apply` → 성공 시 목록·요약·분류별 지출·고정 거래 상태 다시 조회 |
| 취소 | 요청 없음 |
| 실패 | `alert`로 에러 문구, 아무것도 추가되지 않음 |

## 5. 상태별 문구

### 5.1 로딩

| 위치 | 문구 |
|---|---|
| `SummaryPanel` | `월별 요약을 불러오는 중...` |
| `TransactionList` | `거래 내역을 불러오는 중...` |
| `TransactionForm` 분류 선택 | `분류를 불러오는 중...` (분류 선택과 저장 버튼 비활성화) |
| `TransactionForm` 저장 버튼 | `저장 중...` |
| `TransactionItem` 삭제 버튼 | `삭제 중...` |
| (v0.4) `CategoryManager` 목록 | `분류를 불러오는 중...` |
| (v0.4) `CategoryManager` 추가 버튼 | `추가 중...` |
| (v0.5) `BackupButton` | `백업 중...` |
| (v0.8) `CategorySpending` | `분류별 지출을 불러오는 중...` |
| (v0.11) `RecurringManager` 목록 | `고정 거래를 불러오는 중...` |
| (v0.11) `RecurringApplyButton` | `불러오는 중...` |

### 5.2 빈 목록

| 위치 | 문구 |
|---|---|
| `TransactionList` | `2026년 10월에는 거래 내역이 없습니다.` (연·월은 `selected` 값) |
| (v0.6) `TransactionList` 필터 적용 | `2026년 10월에는 '식비'(지출) 거래가 없습니다.` |
| (v0.8) `CategorySpending` | `2026년 10월에는 지출이 없습니다.` |
| (v0.9) `TransactionList` 검색·필터 적용 | `조건에 맞는 거래가 없습니다.` |
| (v0.11) `RecurringManager` | `등록된 고정 거래가 없습니다.` |

### 5.3 에러

서버가 에러 형식(`API_SPEC.md` 1.2절)으로 응답하면 `message`를 그대로 보여 준다. 서버에 연결하지 못했거나 응답이 에러 형식이 아니면 아래 문구를 쓴다.

| 상황 | 문구 |
|---|---|
| 서버에 연결 실패 (fetch 실패) | `서버에 연결할 수 없습니다.` |
| 응답이 에러 형식이 아님 | `알 수 없는 오류가 발생했습니다. (상태 코드: 500)` |

위치별 표시 방식:

| 위치 | 표시 방식 | `다시 시도` 버튼 |
|---|---|---|
| `SummaryPanel` | 요약 자리에 에러 문구 | 있음 |
| `TransactionList` | 목록 자리에 에러 문구 | 있음 |
| `TransactionForm` 분류 불러오기 | 분류 선택 자리에 에러 문구 | 있음 |
| `TransactionForm` 저장 | 폼 위에 에러 문구 | 없음 (다시 저장 클릭) |
| `TransactionItem` 삭제 | `alert` | 없음 |
| (v0.4) `CategoryManager` 불러오기 | 분류 목록 자리에 에러 문구 | 있음 |
| (v0.4) `CategoryManager` 추가·수정·삭제 | 카드 위쪽에 에러 문구 | 없음 (다시 클릭) |
| (v0.5) `BackupButton` | `alert` | 없음 (다시 클릭) |
| (v0.8) `CategorySpending` | 목록 자리에 에러 문구 | 있음 |
| (v0.10) 예산 저장·해제 | 분류 관리 카드 위쪽에 에러 문구 | 없음 |
| (v0.11) `RecurringManager` 불러오기 | 목록 자리에 에러 문구 | 있음 |
| (v0.11) `RecurringManager` 추가·수정·삭제 | 카드 위쪽에 에러 문구 | 없음 |
| (v0.11) `RecurringApplyButton` | `alert` | 없음 |

- 에러가 나도 이전에 보이던 성공 데이터를 남겨 두지 않는다. 화면이 실제 저장 상태와 다르게 보이지 않게 하기 위해서다.
