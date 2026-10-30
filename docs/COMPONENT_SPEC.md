# 컴포넌트 명세 초안 - 개인 가계부

> 기준 문서: `docs/PRD.md`, `docs/API_SPEC.md` (보조: `docs/DATA_MODEL.md`, `docs/TRD.md`)
> 대상 범위: MVP(v0.1 ~ v0.3)

## 1. 개요

- 화면은 한 페이지(`static/index.html`)이고, 화면 조각(컴포넌트)은 `static/app.js`의 **순수 JavaScript 함수**로 만든다. React 같은 프레임워크는 쓰지 않는다.
- 각 컴포넌트는 "Props 객체를 받아 DOM 요소를 그리는 함수"다. 예: `renderSummaryPanel(container, props)`
- 데이터와 상태는 최상위 `App`이 한곳에서 갖고, 하위 컴포넌트에는 Props로 내려 준다. 하위 컴포넌트는 사용자 동작을 콜백(`on...`)으로 `App`에 알린다.
- Props 타입은 TypeScript 문법으로 적었지만 **설명용**이다. 공통 타입(`Transaction`, `TransactionInput`, `MonthlySummary`, `TransactionType`)은 `DATA_MODEL.md` 5절을 따른다.

## 2. 컴포넌트 트리

```
App
├─ MonthSelector          연·월 선택
├─ SummaryPanel           선택한 월의 수입·지출 합계, 잔액
├─ TransactionForm        거래 등록·수정 폼 (유형, 거래일, 금액, 분류, 메모)
└─ TransactionList        선택한 월의 거래 목록
   └─ TransactionItem     거래 1건 (수정·삭제 버튼)

StatusMessage             로딩·빈 목록·에러 문구 (SummaryPanel, TransactionForm, TransactionList 안에서 사용)
```

## 3. 공통 타입

```ts
/** 선택한 연·월 */
type YearMonth = { year: number; month: number }; // month: 1 ~ 12

/** 고정 분류 목록 (GET /api/categories 응답) */
type Categories = { expense: string[]; income: string[] };

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

**하는 일**

| 시점 | 동작 |
|---|---|
| 처음 열 때 | `GET /api/categories`, 그리고 `selected` 기준으로 `GET /api/transactions`, `GET /api/summary` 호출 |
| 월 변경 | `selected` 변경 → 목록·요약 다시 조회 |
| 등록·수정·삭제 성공 | 목록·요약 다시 조회 |

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
};
```

- 서버가 정렬해서 준 순서(거래일 → 등록 시각 → ID 내림차순) 그대로 표시한다.

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

## 5. 상태별 문구

### 5.1 로딩

| 위치 | 문구 |
|---|---|
| `SummaryPanel` | `월별 요약을 불러오는 중...` |
| `TransactionList` | `거래 내역을 불러오는 중...` |
| `TransactionForm` 분류 선택 | `분류를 불러오는 중...` (분류 선택과 저장 버튼 비활성화) |
| `TransactionForm` 저장 버튼 | `저장 중...` |
| `TransactionItem` 삭제 버튼 | `삭제 중...` |

### 5.2 빈 목록

| 위치 | 문구 |
|---|---|
| `TransactionList` | `2026년 10월에는 거래 내역이 없습니다.` (연·월은 `selected` 값) |

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

- 에러가 나도 이전에 보이던 성공 데이터를 남겨 두지 않는다. 화면이 실제 저장 상태와 다르게 보이지 않게 하기 위해서다.
