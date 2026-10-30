"use strict";

// 화면 컴포넌트 명세: docs/COMPONENT_SPEC.md

const TYPE_LABELS = { income: "수입", expense: "지출" };
const CONNECTION_ERROR = { code: "CONNECTION_ERROR", message: "서버에 연결할 수 없습니다." };
const MAX_KEYWORD_LENGTH = 50;
const MIN_MONTH = { year: 1, month: 1 };
const MAX_MONTH = { year: 9999, month: 12 };
const EMPTY_FILTERS = { type: null, category: null, q: null };

// ---------------------------------------------------------------------------
// 공통 도구
// ---------------------------------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function currentYearMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** 연·월을 delta개월 옮긴다. 1월의 이전 달은 전년 12월이다. */
function shiftMonth({ year, month }, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function sameMonth(a, b) {
  return a.year === b.year && a.month === b.month;
}

function formatWon(amount) {
  return `${amount.toLocaleString("ko-KR")}원`;
}

function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** 금액 입력칸의 글자를 숫자로 바꾼다. 비었으면 null. */
function parseAmount(text) {
  const trimmed = String(text).trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** 금액 클라이언트 검사. 문구는 서버 message와 같다. */
function validateAmount(amount) {
  if (amount === null) return "금액을 입력해 주세요.";
  if (!Number.isSafeInteger(amount) || amount < 1) return "금액은 1 이상의 정수여야 합니다.";
  return null;
}

/** DOM 요소를 만든다. attrs: className, text, on<Event>, 그 밖의 속성 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
}

// ---------------------------------------------------------------------------
// API 호출 (docs/API_SPEC.md)
// ---------------------------------------------------------------------------

function unknownError(status) {
  return { status, code: "UNKNOWN_ERROR", message: `알 수 없는 오류가 발생했습니다. (상태 코드: ${status})` };
}

/** 실패 응답을 { status, code, message }로 바꾼다. 에러 형식이 아니면 알 수 없는 오류로 본다. */
async function toApiError(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const error = data && data.error;
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return { status: res.status, code: error.code, message: error.message };
  }
  return unknownError(res.status);
}

/** fetch 후 실패 응답이나 연결 실패를 에러로 던진다. */
async function fetchOrThrow(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw CONNECTION_ERROR;
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function request(method, url, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  const res = await fetchOrThrow(url, options);
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    throw unknownError(res.status);
  }
}

function fallbackBackupFilename() {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `budget-backup-${date}-${pad2(d.getHours())}${pad2(d.getMinutes())}.db`;
}

/** 백업 파일을 받아 { blob, filename }으로 돌려준다. 파일 이름은 응답 헤더를 따른다. */
async function requestBackup() {
  const res = await fetchOrThrow("/api/backup", { method: "GET" });
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  let blob;
  try {
    blob = await res.blob();
  } catch {
    throw CONNECTION_ERROR;
  }
  return { blob, filename: match ? match[1] : fallbackBackupFilename() };
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 월 조회 쿼리. 검색·필터 조건(v0.9)은 있는 것만 붙인다. */
function monthQuery({ year, month }, filters) {
  const params = new URLSearchParams({ year, month });
  if (filters) {
    if (filters.type) params.set("type", filters.type);
    if (filters.category) params.set("category", filters.category);
    if (filters.q) params.set("q", filters.q);
  }
  return params.toString();
}

const api = {
  getCategories: () => request("GET", "/api/categories"),
  listTransactions: (selected, filters) => request("GET", `/api/transactions?${monthQuery(selected, filters)}`),
  getSummary: (selected, filters) => request("GET", `/api/summary?${monthQuery(selected, filters)}`),
  getCategorySpending: (selected) => request("GET", `/api/summary/categories?${monthQuery(selected)}`),
  createTransaction: (input) => request("POST", "/api/transactions", input),
  updateTransaction: (id, input) => request("PUT", `/api/transactions/${id}`, input),
  deleteTransaction: (id) => request("DELETE", `/api/transactions/${id}`),
  createCategory: (input) => request("POST", "/api/categories", input),
  renameCategory: (id, name) => request("PUT", `/api/categories/${id}`, { name }),
  deleteCategory: (id) => request("DELETE", `/api/categories/${id}`),
  listBudgets: () => request("GET", "/api/budgets"),
  setBudget: (categoryId, amount) => request("PUT", `/api/budgets/${categoryId}`, { amount }),
  deleteBudget: (categoryId) => request("DELETE", `/api/budgets/${categoryId}`),
  listRecurring: (selected) => request("GET", `/api/recurring?${monthQuery(selected)}`),
  createRecurring: (input) => request("POST", "/api/recurring", input),
  updateRecurring: (id, input) => request("PUT", `/api/recurring/${id}`, input),
  deleteRecurring: (id) => request("DELETE", `/api/recurring/${id}`),
  applyRecurring: (selected) => request("POST", "/api/recurring/apply", selected),
  downloadBackup: requestBackup,
};

// ---------------------------------------------------------------------------
// StatusMessage
// ---------------------------------------------------------------------------

function StatusMessage({ kind, message, onRetry }) {
  return el("div", { className: `status status-${kind}`, role: kind === "error" ? "alert" : "status" }, [
    el("p", { text: message }),
    onRetry ? el("button", { type: "button", className: "button-secondary", text: "다시 시도", onClick: onRetry }) : null,
  ]);
}

// ---------------------------------------------------------------------------
// BackupButton (v0.5)
// ---------------------------------------------------------------------------

function renderBackupButton(container, { busy, onBackup }) {
  container.replaceChildren(
    el("button", {
      type: "button",
      className: "button-secondary backup-button",
      text: busy ? "백업 중..." : "백업 다운로드",
      disabled: busy,
      onClick: onBackup,
    }),
  );
}

// ---------------------------------------------------------------------------
// MonthSelector / MonthNavigator (v0.7)
// ---------------------------------------------------------------------------

function renderMonthSelector(container, { value, disabled, onChange }) {
  // <input type="month">는 연도를 4자리로 받는다. (예: 0001-01)
  const current = `${String(value.year).padStart(4, "0")}-${pad2(value.month)}`;
  const input = el("input", { type: "month", value: current, disabled, "aria-label": "조회할 연·월" });
  input.addEventListener("change", () => {
    const match = /^(\d{4})-(\d{2})$/.exec(input.value);
    if (!match) {
      // 값을 지우거나 잘못 입력하면 이전 연·월을 유지한다.
      input.value = current;
      return;
    }
    onChange({ year: Number(match[1]), month: Number(match[2]) });
  });
  container.replaceChildren(input);
}

function renderMonthNavigator(container, { value, today, disabled, onChange }) {
  const button = (text, target, atLimit) =>
    el("button", {
      type: "button",
      className: "button-secondary nav-button",
      text,
      disabled: disabled || atLimit,
      onClick: () => onChange(target),
    });
  container.replaceChildren(
    button("이전 달", shiftMonth(value, -1), sameMonth(value, MIN_MONTH)),
    button("다음 달", shiftMonth(value, 1), sameMonth(value, MAX_MONTH)),
    button("이번 달", today, sameMonth(value, today)),
  );
}

// ---------------------------------------------------------------------------
// SummaryPanel
// ---------------------------------------------------------------------------

function renderSummaryPanel(container, { summary, onRetry }) {
  let body;
  if (summary.status === "loading") {
    body = StatusMessage({ kind: "loading", message: "월별 요약을 불러오는 중..." });
  } else if (summary.status === "error") {
    body = StatusMessage({ kind: "error", message: summary.error.message, onRetry });
  } else {
    const { income, expense, balance } = summary.data;
    body = el("dl", { className: "summary" }, [
      el("div", {}, [el("dt", { text: "수입" }), el("dd", { className: "income", text: formatWon(income) })]),
      el("div", {}, [el("dt", { text: "지출" }), el("dd", { className: "expense", text: formatWon(expense) })]),
      el("div", {}, [el("dt", { text: "잔액" }), el("dd", { text: formatWon(balance) })]),
    ]);
  }
  container.replaceChildren(el("h2", { text: "월별 요약" }), body);
}

// ---------------------------------------------------------------------------
// CategorySpending (v0.8, v0.10 예산)
// ---------------------------------------------------------------------------

function renderCategorySpending(container, { spending, selected, onRetry }) {
  let body;
  if (spending.status === "loading") {
    body = StatusMessage({ kind: "loading", message: "분류별 지출을 불러오는 중..." });
  } else if (spending.status === "error") {
    body = StatusMessage({ kind: "error", message: spending.error.message, onRetry });
  } else if (spending.data.items.length === 0) {
    body = StatusMessage({ kind: "empty", message: `${selected.year}년 ${selected.month}월에는 지출이 없습니다.` });
  } else {
    const { total, items } = spending.data;
    body = el("ul", { className: "spending-list" }, items.map((item) => SpendingItem({ item, total })));
  }
  container.replaceChildren(el("h2", { text: "분류별 지출" }), body);
}

function SpendingItem({ item, total }) {
  const hasBudget = item.budget !== null;
  const over = hasBudget && item.remaining < 0;
  // 예산이 있으면 예산 대비, 없으면 그 달 지출 합계 대비 막대 길이
  const ratio = hasBudget ? Math.min(item.amount / item.budget, 1) : total > 0 ? item.amount / total : 0;
  let budgetLine = null;
  if (hasBudget) {
    const rest = over ? `${formatWon(-item.remaining)} 초과` : `${formatWon(item.remaining)} 남음`;
    budgetLine = el("p", {
      className: `spending-budget${over ? " is-over" : ""}`,
      text: `예산 ${formatWon(item.budget)} · ${percent(item.amount, item.budget)}% 사용 · ${rest}`,
    });
  }
  return el("li", { className: "spending-item" }, [
    el("div", { className: "spending-head" }, [
      el("span", { className: "spending-name", text: item.category }),
      el("span", { className: "spending-meta", text: `${item.count}건 · ${percent(item.amount, total)}%` }),
      el("span", { className: "spending-amount", text: formatWon(item.amount) }),
    ]),
    el("div", { className: "spending-bar" }, [
      el("div", { className: `spending-fill${over ? " is-over" : ""}`, style: `width: ${(ratio * 100).toFixed(1)}%` }),
    ]),
    budgetLine,
  ]);
}

// ---------------------------------------------------------------------------
// TransactionForm
// ---------------------------------------------------------------------------

/**
 * 입력값은 폼의 DOM이 가지고 있다. resetKey가 바뀔 때만 폼을 새로 만들어
 * (등록 모드 기본값 또는 수정할 거래의 값으로) 채우고, 그 밖에는 상태 표시만 바꾼다.
 */
function renderTransactionForm(container, props) {
  let form = container.querySelector("form");
  if (!form || form.dataset.resetKey !== String(props.resetKey)) {
    form = buildTransactionForm(props);
    container.replaceChildren(form);
  }
  form.latestProps = props;
  updateTransactionForm(form, props);
}

function buildTransactionForm({ editing, resetKey }) {
  const values = editing || { type: "expense", date: todayString(), amount: "", category: "", memo: "" };

  const typeRadio = (type) =>
    el("label", { className: "radio" }, [
      el("input", { type: "radio", name: "type", value: type, checked: values.type === type }),
      ` ${TYPE_LABELS[type]}`,
    ]);

  const form = el("form", { className: "transaction-form", novalidate: true }, [
    el("h2"),
    el("p", { className: "form-error", role: "alert", hidden: true }),
    el("fieldset", { className: "field type-field" }, [el("legend", { text: "유형" }), typeRadio("expense"), typeRadio("income")]),
    el("label", { className: "field" }, ["거래일", el("input", { type: "date", name: "date", value: values.date })]),
    el("label", { className: "field" }, [
      "금액",
      el("input", { type: "number", name: "amount", min: "1", step: "1", inputmode: "numeric", value: values.amount }),
    ]),
    el("div", { className: "field category-field" }),
    el("label", { className: "field" }, ["메모", el("input", { type: "text", name: "memo", value: values.memo || "" })]),
    el("div", { className: "form-actions" }, [
      el("button", { type: "submit", className: "button-primary" }),
      el("button", { type: "button", className: "button-secondary cancel-button", text: "취소" }),
    ]),
  ]);
  form.dataset.resetKey = String(resetKey);
  form.querySelector(".category-field").dataset.pending = values.category;

  for (const radio of form.querySelectorAll('input[name="type"]')) {
    radio.addEventListener("change", () => {
      // 유형을 바꾸면 분류 선택을 초기화한다.
      form.querySelector(".category-field").dataset.pending = "";
      renderCategoryField(form, form.latestProps);
    });
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.latestProps.onSubmit(readTransactionInput(form));
  });
  form.querySelector(".cancel-button").addEventListener("click", () => form.latestProps.onCancelEdit());
  return form;
}

function updateTransactionForm(form, props) {
  const isEditing = props.editing !== null;
  form.querySelector("h2").textContent = isEditing ? "거래 수정" : "거래 등록";

  const errorBox = form.querySelector(".form-error");
  errorBox.hidden = !props.error;
  errorBox.textContent = props.error ? props.error.message : "";

  const submit = form.querySelector('button[type="submit"]');
  submit.textContent = props.submitting ? "저장 중..." : isEditing ? "수정 저장" : "저장";
  submit.disabled = props.submitting || props.categories.status !== "success";

  const cancel = form.querySelector(".cancel-button");
  cancel.hidden = !isEditing;
  cancel.disabled = props.submitting;

  renderCategoryField(form, props);
}

function renderCategoryField(form, { categories, onRetryCategories }) {
  const field = form.querySelector(".category-field");
  const type = form.elements.type.value;
  const key = `${categories.status}:${type}`;
  if (field.dataset.key === key) return;
  field.dataset.key = key;

  if (categories.status === "loading") {
    field.replaceChildren(
      el("label", {}, ["분류", el("select", { name: "category", disabled: true }, [el("option", { value: "", text: "분류를 불러오는 중..." })])]),
    );
    return;
  }
  if (categories.status === "error") {
    field.replaceChildren(
      el("span", { text: "분류" }),
      StatusMessage({ kind: "error", message: categories.error.message, onRetry: onRetryCategories }),
    );
    return;
  }

  const names = categories.data[type].map((category) => category.name);
  const select = el("select", { name: "category" }, [
    el("option", { value: "", text: "분류 선택" }),
    ...names.map((name) => el("option", { value: name, text: name })),
  ]);
  const pending = field.dataset.pending || "";
  select.value = names.includes(pending) ? pending : "";
  select.addEventListener("change", () => {
    field.dataset.pending = select.value;
  });
  field.replaceChildren(el("label", {}, ["분류", select]));
}

function readTransactionInput(form) {
  const category = form.elements.category;
  return {
    date: form.elements.date.value,
    type: form.elements.type.value,
    amount: parseAmount(form.elements.amount.value),
    category: category ? category.value : "",
    memo: form.elements.memo.value.trim() || null,
  };
}

/** 클라이언트 검사. 문구는 서버 message와 같게 맞춘다. */
function validateTransactionInput(input) {
  if (!input.date) return "거래일을 입력해 주세요.";
  const amountError = validateAmount(input.amount);
  if (amountError) return amountError;
  if (!input.category) return "분류를 선택해 주세요.";
  return null;
}

// ---------------------------------------------------------------------------
// TransactionList / TransactionFilters (v0.9) / RecurringApplyButton (v0.11)
// ---------------------------------------------------------------------------

function hasFilters(filters) {
  return Boolean(filters.type || filters.category || filters.q);
}

function TransactionFilters({ categories, filters, qDraft, onChange, onInvalid }) {
  const typeSelect = el("select", { className: "filter-type", "aria-label": "유형 필터" }, [
    el("option", { value: "", text: "전체" }),
    el("option", { value: "expense", text: "지출" }),
    el("option", { value: "income", text: "수입" }),
  ]);
  typeSelect.value = filters.type || "";
  typeSelect.addEventListener("change", () => {
    const type = typeSelect.value || null;
    // 유형이 바뀌면 지금 고른 분류는 그 유형에 없으므로 해제한다.
    onChange({ ...filters, type, category: type && type === filters.type ? filters.category : null });
  });

  const categorySelect = el("select", { className: "filter-select", "aria-label": "분류 필터" }, [
    el("option", { value: "", text: "전체 분류" }),
  ]);
  if (categories.status === "success") {
    for (const type of filters.type ? [filters.type] : ["expense", "income"]) {
      const options = categories.data[type].map((c) => el("option", { value: `${type}:${c.name}`, text: c.name }));
      if (filters.type) categorySelect.append(...options);
      else categorySelect.append(el("optgroup", { label: TYPE_LABELS[type] }, options));
    }
  }
  const current = filters.category ? `${filters.type}:${filters.category}` : "";
  if (current && ![...categorySelect.options].some((option) => option.value === current)) {
    // 분류 목록을 불러오는 중이어도 선택한 분류가 보이게 한다.
    categorySelect.append(el("option", { value: current, text: filters.category }));
  }
  categorySelect.value = current;
  categorySelect.addEventListener("change", () => {
    if (!categorySelect.value) return onChange({ ...filters, category: null });
    const split = categorySelect.value.indexOf(":");
    onChange({ ...filters, type: categorySelect.value.slice(0, split), category: categorySelect.value.slice(split + 1) });
  });

  const qInput = el("input", { type: "search", className: "filter-q", value: qDraft, placeholder: "메모 검색", "aria-label": "메모 검색어" });
  const searchForm = el("form", { className: "filter-search", novalidate: true }, [
    qInput,
    el("button", { type: "submit", className: "button-secondary", text: "검색" }),
  ]);
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = qInput.value.trim();
    if ([...q].length > MAX_KEYWORD_LENGTH) return onInvalid(`검색어는 ${MAX_KEYWORD_LENGTH}자 이하여야 합니다.`);
    onChange({ ...filters, q: q || null });
  });

  const reset = el("button", {
    type: "button",
    className: "button-secondary filter-reset",
    text: "필터 초기화",
    disabled: !hasFilters(filters),
    onClick: () => {
      qInput.value = "";
      onChange({ ...EMPTY_FILTERS });
    },
  });

  return el("div", { className: "list-filters" }, [
    el("label", { className: "filter-field" }, [el("span", { text: "유형" }), typeSelect]),
    el("label", { className: "filter-field" }, [el("span", { text: "분류" }), categorySelect]),
    searchForm,
    reset,
  ]);
}

/** 조건이 있을 때 결과 건수와 합계 한 줄. 유형이 정해지면 그 유형 합계만 보여 준다. */
function FilterResult({ filters, transactions, filterSummary }) {
  if (!hasFilters(filters)) return null;
  if (filterSummary && filterSummary.status === "error") {
    return el("p", { className: "filter-total is-error", text: filterSummary.error.message });
  }
  const typeClass = filters.type ? ` ${filters.type}` : "";
  if (transactions.status !== "success" || !filterSummary || filterSummary.status !== "success") {
    return el("p", { className: `filter-total${typeClass}`, text: "검색 결과 · 합계 계산 중..." });
  }
  const { income, expense } = filterSummary.data;
  const sums = filters.type
    ? [`${TYPE_LABELS[filters.type]} ${formatWon(filterSummary.data[filters.type])}`]
    : [`수입 ${formatWon(income)}`, `지출 ${formatWon(expense)}`];
  return el("p", {
    className: `filter-total${typeClass}`,
    text: ["검색 결과", `${transactions.data.length}건`, ...sums].join(" · "),
  });
}

function RecurringApplyButton({ recurring, applying, onApply }) {
  let text;
  let pending = 0;
  if (recurring.status === "loading") text = "고정 거래 확인 중...";
  else if (recurring.status === "error") text = "고정 거래를 확인하지 못했습니다";
  else if (recurring.data.length === 0) text = "등록된 고정 거래 없음";
  else {
    pending = recurring.data.filter((item) => !item.applied).length;
    text = pending ? `이번 달 고정 거래 불러오기 (${pending}건)` : "고정 거래를 모두 불러왔습니다";
  }
  return el("button", {
    type: "button",
    className: "button-secondary recurring-apply",
    text: applying ? "불러오는 중..." : text,
    disabled: applying || pending === 0,
    onClick: () => onApply(pending),
  });
}

function renderTransactionList(container, props) {
  const { transactions, selected, editingId, deletingId, onEdit, onDelete, onRetry, filters } = props;
  // 다시 그려도 입력 중인(아직 검색하지 않은) 검색어를 유지한다.
  const previousQ = container.querySelector(".filter-q");
  const qDraft = previousQ ? previousQ.value : filters.q || "";

  let body;
  if (transactions.status === "loading") {
    body = StatusMessage({ kind: "loading", message: "거래 내역을 불러오는 중..." });
  } else if (transactions.status === "error") {
    body = StatusMessage({ kind: "error", message: transactions.error.message, onRetry });
  } else if (transactions.data.length === 0) {
    const message = hasFilters(filters)
      ? "조건에 맞는 거래가 없습니다."
      : `${selected.year}년 ${selected.month}월에는 거래 내역이 없습니다.`;
    body = StatusMessage({ kind: "empty", message });
  } else {
    body = el(
      "ul",
      { className: "transaction-list" },
      transactions.data.map((transaction) =>
        TransactionItem({
          transaction,
          isEditing: transaction.id === editingId,
          isDeleting: transaction.id === deletingId,
          onEdit,
          onDelete,
        }),
      ),
    );
  }
  container.replaceChildren(
    ...[
      el("h2", { text: "거래 내역" }),
      TransactionFilters({ ...props, qDraft, onChange: props.onFiltersChange, onInvalid: props.onFilterInvalid }),
      props.filterError ? el("p", { className: "form-error filter-error", role: "alert", text: props.filterError.message }) : null,
      FilterResult(props),
      el("div", { className: "recurring-apply-row" }, [RecurringApplyButton({ recurring: props.recurring, applying: props.applying, onApply: props.onApplyRecurring })]),
      body,
    ].filter(Boolean),
  );
}

function TransactionItem({ transaction, isEditing, isDeleting, onEdit, onDelete }) {
  const t = transaction;
  return el("li", { className: `transaction-item${isEditing ? " is-editing" : ""}` }, [
    el("div", { className: "item-main" }, [
      el("span", { className: "item-date", text: t.date }),
      el("span", { className: `item-type ${t.type}`, text: TYPE_LABELS[t.type] }),
      el("span", { className: "item-category", text: t.category }),
      el("span", { className: "item-memo", text: t.memo || "" }),
    ]),
    el("span", { className: `item-amount ${t.type}`, text: formatWon(t.amount) }),
    el("div", { className: "item-actions" }, [
      el("button", { type: "button", className: "button-secondary", text: "수정", disabled: isDeleting, onClick: () => onEdit(t) }),
      el("button", {
        type: "button",
        className: "button-danger",
        text: isDeleting ? "삭제 중..." : "삭제",
        disabled: isDeleting,
        onClick: () => onDelete(t),
      }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// CategoryManager / CategoryItem (v0.4, v0.10 예산)
// ---------------------------------------------------------------------------

const MAX_CATEGORY_NAME_LENGTH = 20;

/** 클라이언트 검사. 문구는 서버 message와 같게 맞춘다. 길이는 유니코드 문자 수로 센다. */
function validateCategoryName(name) {
  const trimmed = name.trim();
  if (!trimmed) return "분류 이름을 입력해 주세요.";
  if ([...trimmed].length > MAX_CATEGORY_NAME_LENGTH) return `분류 이름은 ${MAX_CATEGORY_NAME_LENGTH}자 이하여야 합니다.`;
  return null;
}

/**
 * 다시 그릴 때 입력 중인 값(추가할 이름·유형, 수정 중인 이름, 입력 중인 예산)을 유지한다.
 * 추가 입력칸은 resetKey가 바뀔 때만 비운다.
 */
function renderCategoryManager(container, props) {
  const sameKey = container.dataset.resetKey === String(props.resetKey);
  const previousName = container.querySelector(".category-add input[name=name]");
  const previousType = container.querySelector(".category-add input[name=categoryType]:checked");
  const addName = sameKey && previousName ? previousName.value : "";
  const addType = sameKey && previousType ? previousType.value : "expense";

  const draftOf = (selector, id) => {
    const input = container.querySelector(selector);
    return input && Number(input.dataset.id) === id ? input.value : null;
  };
  const renameDraft = draftOf(".rename-input", props.renamingId);
  const budgetDraft = draftOf(".budget-input", props.budgetEditingId);
  const budgetByCategory = new Map(
    props.budgets.status === "success" ? props.budgets.data.map((b) => [b.category_id, b.amount]) : [],
  );

  let groups;
  if (props.categories.status === "loading") {
    groups = StatusMessage({ kind: "loading", message: "분류를 불러오는 중..." });
  } else if (props.categories.status === "error") {
    groups = StatusMessage({ kind: "error", message: props.categories.error.message, onRetry: props.onRetry });
  } else {
    groups = el(
      "div",
      { className: "category-groups" },
      ["expense", "income"].map((type) =>
        el("div", { className: "category-group" }, [
          el("h3", { className: type, text: `${TYPE_LABELS[type]} 분류` }),
          el(
            "ul",
            { className: "category-list" },
            props.categories.data[type].map((category) =>
              CategoryItem({
                ...props,
                category,
                budget: budgetByCategory.has(category.id) ? budgetByCategory.get(category.id) : null,
                isRenaming: category.id === props.renamingId,
                isBudgeting: category.id === props.budgetEditingId,
                renameDraft,
                budgetDraft,
              }),
            ),
          ),
        ]),
      ),
    );
  }

  const typeRadio = (type) =>
    el("label", { className: "radio" }, [
      el("input", { type: "radio", name: "categoryType", value: type, checked: addType === type, disabled: props.busy }),
      ` ${TYPE_LABELS[type]}`,
    ]);
  const nameInput = el("input", { type: "text", name: "name", value: addName, disabled: props.busy, "aria-label": "새 분류 이름" });
  const addForm = el("form", { className: "category-add", novalidate: true }, [
    el("fieldset", { className: "field type-field" }, [el("legend", { text: "분류 추가" }), typeRadio("expense"), typeRadio("income")]),
    el("div", { className: "category-add-row" }, [
      nameInput,
      el("button", { type: "submit", className: "button-primary", text: props.busy ? "추가 중..." : "추가", disabled: props.busy }),
    ]),
  ]);
  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    props.onAdd({ type: addForm.querySelector("input[name=categoryType]:checked").value, name: nameInput.value });
  });

  container.dataset.resetKey = String(props.resetKey);
  const errorBox = props.error ? el("p", { className: "form-error", role: "alert", text: props.error.message }) : null;
  // replaceChildren은 null을 "null" 글자로 넣으므로 빈 항목을 걸러 낸다.
  container.replaceChildren(...[el("h2", { text: "분류 관리" }), errorBox, groups, addForm].filter(Boolean));
}

function CategoryItem(props) {
  const { category, budget, isRenaming, isBudgeting, renameDraft, budgetDraft, busy } = props;
  const isExpense = category.type === "expense";

  if (isRenaming) {
    const input = el("input", {
      type: "text",
      className: "rename-input",
      value: renameDraft ?? category.name,
      disabled: busy,
      "aria-label": `'${category.name}' 새 이름`,
    });
    input.dataset.id = String(category.id);
    const form = el("form", { className: "category-item is-renaming", novalidate: true }, [
      input,
      el("div", { className: "item-actions" }, [
        el("button", { type: "submit", className: "button-primary", text: "저장", disabled: busy }),
        el("button", { type: "button", className: "button-secondary", text: "취소", disabled: busy, onClick: props.onCancelRename }),
      ]),
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      props.onRename(category, input.value);
    });
    return el("li", {}, [form]);
  }

  if (isBudgeting) {
    const input = el("input", {
      type: "number",
      className: "budget-input",
      min: "1",
      step: "1",
      inputmode: "numeric",
      placeholder: "월 예산",
      value: budgetDraft ?? (budget === null ? "" : String(budget)),
      disabled: busy,
      "aria-label": `'${category.name}' 월 예산`,
    });
    input.dataset.id = String(category.id);
    const form = el("form", { className: "category-item is-budgeting", novalidate: true }, [
      el("span", { className: "category-name", text: category.name }),
      input,
      el("div", { className: "item-actions" }, [
        el("button", { type: "submit", className: "button-primary", text: "저장", disabled: busy }),
        budget !== null
          ? el("button", { type: "button", className: "button-danger", text: "해제", disabled: busy, onClick: () => props.onDeleteBudget(category) })
          : null,
        el("button", { type: "button", className: "button-secondary", text: "취소", disabled: busy, onClick: props.onCancelBudget }),
      ]),
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      props.onSaveBudget(category, input.value);
    });
    return el("li", {}, [form]);
  }

  const actions = [];
  if (isExpense) {
    actions.push(el("button", { type: "button", className: "button-secondary", text: "예산", disabled: busy, onClick: () => props.onStartBudget(category) }));
  }
  if (!category.is_default) {
    actions.push(
      el("button", { type: "button", className: "button-secondary", text: "수정", disabled: busy, onClick: () => props.onStartRename(category) }),
      el("button", { type: "button", className: "button-danger", text: "삭제", disabled: busy, onClick: () => props.onDelete(category) }),
    );
  }
  return el("li", { className: "category-item" }, [
    el("span", { className: "category-name", text: category.name }),
    category.is_default ? el("span", { className: "badge", text: "기본" }) : null,
    isExpense && budget !== null ? el("span", { className: "budget-label", text: `예산 ${formatWon(budget)}` }) : null,
    actions.length ? el("div", { className: "item-actions" }, actions) : null,
  ]);
}

// ---------------------------------------------------------------------------
// RecurringManager / RecurringItem (v0.11)
// ---------------------------------------------------------------------------

/** 고정 거래 폼도 거래 폼처럼 resetKey가 바뀔 때만 새로 채우고, 그 밖에는 입력값을 유지한다. */
function renderRecurringManager(container, props) {
  let form = container.querySelector("form.recurring-form");
  if (!form || form.dataset.resetKey !== String(props.resetKey)) form = buildRecurringForm(props);
  form.latestProps = props;
  updateRecurringForm(form, props);

  let list;
  if (props.recurring.status === "loading") {
    list = StatusMessage({ kind: "loading", message: "고정 거래를 불러오는 중..." });
  } else if (props.recurring.status === "error") {
    list = StatusMessage({ kind: "error", message: props.recurring.error.message, onRetry: props.onRetry });
  } else if (props.recurring.data.length === 0) {
    list = StatusMessage({ kind: "empty", message: "등록된 고정 거래가 없습니다." });
  } else {
    list = el(
      "ul",
      { className: "recurring-list" },
      props.recurring.data.map((item) =>
        RecurringItem({
          item,
          busy: props.busy,
          isEditing: props.editing !== null && props.editing.id === item.id,
          onEdit: props.onEdit,
          onDelete: props.onDelete,
        }),
      ),
    );
  }
  const errorBox = props.error ? el("p", { className: "form-error", role: "alert", text: props.error.message }) : null;
  container.replaceChildren(...[el("h2", { text: "고정 거래" }), errorBox, list, form].filter(Boolean));
}

function buildRecurringForm({ editing, resetKey }) {
  const values = editing || { day: "", type: "expense", amount: "", category_id: "", memo: "" };
  const typeRadio = (type) =>
    el("label", { className: "radio" }, [
      el("input", { type: "radio", name: "recurringType", value: type, checked: values.type === type }),
      ` ${TYPE_LABELS[type]}`,
    ]);
  const form = el("form", { className: "recurring-form", novalidate: true }, [
    el("h3", { className: "recurring-form-title" }),
    el("fieldset", { className: "field type-field" }, [el("legend", { text: "유형" }), typeRadio("expense"), typeRadio("income")]),
    el("label", { className: "field" }, [
      "매달 날짜",
      el("input", { type: "number", name: "day", min: "1", max: "31", step: "1", inputmode: "numeric", value: values.day, placeholder: "1 ~ 31" }),
    ]),
    el("label", { className: "field" }, [
      "금액",
      el("input", { type: "number", name: "amount", min: "1", step: "1", inputmode: "numeric", value: values.amount }),
    ]),
    el("div", { className: "field recurring-category-field" }),
    el("label", { className: "field" }, ["메모", el("input", { type: "text", name: "memo", value: values.memo || "" })]),
    el("div", { className: "form-actions" }, [
      el("button", { type: "submit", className: "button-primary" }),
      el("button", { type: "button", className: "button-secondary cancel-button", text: "취소" }),
    ]),
  ]);
  form.dataset.resetKey = String(resetKey);
  form.querySelector(".recurring-category-field").dataset.pending = String(values.category_id);

  for (const radio of form.querySelectorAll('input[name="recurringType"]')) {
    radio.addEventListener("change", () => {
      form.querySelector(".recurring-category-field").dataset.pending = "";
      renderRecurringCategoryField(form, form.latestProps);
    });
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.latestProps.onSubmit(readRecurringInput(form));
  });
  form.querySelector(".cancel-button").addEventListener("click", () => form.latestProps.onCancelEdit());
  return form;
}

function updateRecurringForm(form, props) {
  const isEditing = props.editing !== null;
  form.querySelector(".recurring-form-title").textContent = isEditing ? "고정 거래 수정" : "고정 거래 추가";
  const submit = form.querySelector('button[type="submit"]');
  submit.textContent = props.busy ? "저장 중..." : isEditing ? "수정 저장" : "추가";
  submit.disabled = props.busy || props.categories.status !== "success";
  const cancel = form.querySelector(".cancel-button");
  cancel.hidden = !isEditing;
  cancel.disabled = props.busy;
  renderRecurringCategoryField(form, props);
}

function renderRecurringCategoryField(form, { categories }) {
  const field = form.querySelector(".recurring-category-field");
  const type = form.elements.recurringType.value;
  const key = `${categories.status}:${type}`;
  if (field.dataset.key === key) return;
  field.dataset.key = key;

  const options = categories.status === "success" ? categories.data[type] : [];
  const select = el("select", { name: "category_id", disabled: categories.status !== "success" }, [
    el("option", { value: "", text: categories.status === "loading" ? "분류를 불러오는 중..." : "분류 선택" }),
    ...options.map((c) => el("option", { value: String(c.id), text: c.name })),
  ]);
  const pending = field.dataset.pending || "";
  select.value = options.some((c) => String(c.id) === pending) ? pending : "";
  select.addEventListener("change", () => {
    field.dataset.pending = select.value;
  });
  field.replaceChildren(el("label", {}, ["분류", select]));
}

function readRecurringInput(form) {
  const dayText = form.elements.day.value.trim();
  const categoryId = form.elements.category_id ? form.elements.category_id.value : "";
  return {
    day: dayText === "" ? null : Number(dayText),
    type: form.elements.recurringType.value,
    amount: parseAmount(form.elements.amount.value),
    category_id: categoryId === "" ? null : Number(categoryId),
    memo: form.elements.memo.value.trim() || null,
  };
}

function validateRecurringInput(input) {
  if (input.day === null) return "날을 입력해 주세요.";
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) return "날은 1부터 31 사이여야 합니다.";
  const amountError = validateAmount(input.amount);
  if (amountError) return amountError;
  if (input.category_id === null) return "분류를 선택해 주세요.";
  return null;
}

function recurringLabel(item) {
  const parts = [`매달 ${item.day}일`, TYPE_LABELS[item.type], item.category, formatWon(item.amount)];
  if (item.memo) parts.push(item.memo);
  return parts.join(" · ");
}

function RecurringItem({ item, busy, isEditing, onEdit, onDelete }) {
  return el("li", { className: `recurring-item${isEditing ? " is-editing" : ""}` }, [
    el("div", { className: "recurring-main" }, [
      el("span", { className: `item-type ${item.type}`, text: TYPE_LABELS[item.type] }),
      el("span", { className: "recurring-text", text: recurringLabel(item) }),
      item.day >= 29 ? el("span", { className: "badge", text: "없는 달은 말일" }) : null,
    ]),
    el("div", { className: "item-actions" }, [
      el("button", { type: "button", className: "button-secondary", text: "수정", disabled: busy, onClick: () => onEdit(item) }),
      el("button", { type: "button", className: "button-danger", text: "삭제", disabled: busy, onClick: () => onDelete(item) }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const dom = {
  backup: document.getElementById("backup-button"),
  month: document.getElementById("month-selector"),
  navigator: document.getElementById("month-navigator"),
  summary: document.getElementById("summary-panel"),
  spending: document.getElementById("category-spending"),
  form: document.getElementById("transaction-form"),
  categories: document.getElementById("category-manager"),
  recurring: document.getElementById("recurring-manager"),
  list: document.getElementById("transaction-list"),
};

const state = {
  selected: currentYearMonth(),
  categories: { status: "loading" },
  transactions: { status: "loading" },
  summary: { status: "loading" },
  editing: null,
  submitting: false,
  formError: null,
  deletingId: null,
  formResetKey: 0,
  categoryBusy: false,
  categoryError: null,
  renamingCategoryId: null,
  categoryResetKey: 0,
  backingUp: false,
  filters: { ...EMPTY_FILTERS },
  filterError: null,
  filterSummary: null,
  categorySpending: { status: "loading" },
  budgets: { status: "loading" },
  budgetEditingId: null,
  recurring: { status: "loading" },
  recurringEditing: null,
  recurringBusy: false,
  recurringError: null,
  recurringResetKey: 0,
  applyingRecurring: false,
};

// 응답이 늦게 도착해 최신 상태를 덮어쓰지 않도록 요청마다 번호를 붙인다.
const latestRequest = {
  categories: 0,
  transactions: 0,
  summary: 0,
  filterSummary: 0,
  categorySpending: 0,
  budgets: 0,
  recurring: 0,
};

function renderBackup() {
  renderBackupButton(dom.backup, { busy: state.backingUp, onBackup: handleBackup });
}

function renderMonth() {
  renderMonthSelector(dom.month, { value: state.selected, disabled: state.submitting, onChange: handleMonthChange });
  renderMonthNavigator(dom.navigator, {
    value: state.selected,
    today: currentYearMonth(),
    disabled: state.submitting,
    onChange: handleMonthChange,
  });
}

function renderSummary() {
  renderSummaryPanel(dom.summary, { summary: state.summary, onRetry: loadSummary });
}

function renderSpending() {
  renderCategorySpending(dom.spending, { spending: state.categorySpending, selected: state.selected, onRetry: loadCategorySpending });
}

function renderForm() {
  renderTransactionForm(dom.form, {
    categories: state.categories,
    editing: state.editing,
    submitting: state.submitting,
    error: state.formError,
    resetKey: state.formResetKey,
    onSubmit: handleSubmit,
    onCancelEdit: handleCancelEdit,
    onRetryCategories: loadCategories,
  });
}

function renderCategories() {
  renderCategoryManager(dom.categories, {
    categories: state.categories,
    budgets: state.budgets,
    busy: state.categoryBusy,
    error: state.categoryError,
    renamingId: state.renamingCategoryId,
    budgetEditingId: state.budgetEditingId,
    resetKey: state.categoryResetKey,
    onAdd: handleAddCategory,
    onStartRename: handleStartRenameCategory,
    onRename: handleRenameCategory,
    onCancelRename: handleCancelRenameCategory,
    onDelete: handleDeleteCategory,
    onStartBudget: handleStartBudget,
    onSaveBudget: handleSaveBudget,
    onDeleteBudget: handleDeleteBudget,
    onCancelBudget: handleCancelBudget,
    onRetry: loadCategories,
  });
}

function renderRecurring() {
  renderRecurringManager(dom.recurring, {
    recurring: state.recurring,
    categories: state.categories,
    editing: state.recurringEditing,
    busy: state.recurringBusy,
    error: state.recurringError,
    resetKey: state.recurringResetKey,
    onSubmit: handleSubmitRecurring,
    onCancelEdit: handleCancelRecurring,
    onEdit: handleEditRecurring,
    onDelete: handleDeleteRecurring,
    onRetry: loadRecurring,
  });
}

function renderList() {
  renderTransactionList(dom.list, {
    transactions: state.transactions,
    selected: state.selected,
    editingId: state.editing ? state.editing.id : null,
    deletingId: state.deletingId,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onRetry: () => {
      loadTransactions();
      loadFilterSummary();
    },
    categories: state.categories,
    filters: state.filters,
    filterError: state.filterError,
    filterSummary: state.filterSummary,
    onFiltersChange: handleFiltersChange,
    onFilterInvalid: handleFilterInvalid,
    recurring: state.recurring,
    applying: state.applyingRecurring,
    onApplyRecurring: handleApplyRecurring,
  });
}

async function load(name, fetcher, render) {
  const requestId = ++latestRequest[name];
  state[name] = { status: "loading" };
  render();
  let next;
  try {
    next = { status: "success", data: await fetcher() };
  } catch (error) {
    next = { status: "error", error };
  }
  if (requestId !== latestRequest[name]) return;
  state[name] = next;
  render();
}

async function loadCategories() {
  await load("categories", api.getCategories, () => {
    renderForm();
    renderCategories();
    renderRecurring();
    renderList();
  });
  // 필터로 고른 분류가 삭제되었으면 분류 조건을 해제한다.
  const { filters, categories } = state;
  if (filters.category && categories.status === "success" && !categories.data[filters.type].some((c) => c.name === filters.category)) {
    handleFiltersChange({ ...filters, type: null, category: null });
  }
}

function loadTransactions() {
  const selected = { ...state.selected };
  const filters = { ...state.filters };
  return load("transactions", () => api.listTransactions(selected, filters), renderList);
}

function loadSummary() {
  const selected = { ...state.selected };
  return load("summary", () => api.getSummary(selected), renderSummary);
}

/** 조건이 있을 때만 걸러진 거래의 합계를 불러온다. 월별 요약(loadSummary)은 항상 전체 기준이다. */
function loadFilterSummary() {
  if (!hasFilters(state.filters)) {
    latestRequest.filterSummary += 1; // 진행 중인 이전 응답이 덮어쓰지 않게 한다
    state.filterSummary = null;
    renderList();
    return Promise.resolve();
  }
  const selected = { ...state.selected };
  const filters = { ...state.filters };
  return load("filterSummary", () => api.getSummary(selected, filters), renderList);
}

function loadCategorySpending() {
  const selected = { ...state.selected };
  return load("categorySpending", () => api.getCategorySpending(selected), renderSpending);
}

function loadBudgets() {
  return load("budgets", api.listBudgets, renderCategories);
}

function loadRecurring() {
  const selected = { ...state.selected };
  return load("recurring", () => api.listRecurring(selected), () => {
    renderRecurring();
    renderList();
  });
}

function loadMonth() {
  return Promise.all([
    loadTransactions(),
    loadSummary(),
    loadFilterSummary(),
    loadCategorySpending(),
    loadRecurring(),
  ]);
}

function handleFiltersChange(filters) {
  state.filters = filters;
  state.filterError = null;
  loadTransactions();
  loadFilterSummary();
}

function handleFilterInvalid(message) {
  state.filterError = { code: "CLIENT_VALIDATION", message };
  renderList();
}

function resetForm() {
  state.editing = null;
  state.formError = null;
  state.formResetKey += 1;
}

function handleMonthChange(value) {
  state.selected = value;
  renderMonth();
  loadMonth();
}

async function handleSubmit(input) {
  if (state.submitting) return;

  const message = validateTransactionInput(input);
  if (message) {
    state.formError = { code: "CLIENT_VALIDATION", message };
    renderForm();
    return;
  }

  const editing = state.editing;
  state.submitting = true;
  state.formError = null;
  renderForm();
  renderMonth();

  try {
    const saved = editing ? await api.updateTransaction(editing.id, input) : await api.createTransaction(input);
    resetForm();
    // 저장한 거래가 바로 보이도록 그 거래의 연·월로 이동한다.
    const [year, month] = saved.date.split("-").map(Number);
    state.selected = { year, month };
    loadMonth();
  } catch (error) {
    state.formError = error;
    if (editing && error.code === "TRANSACTION_NOT_FOUND") loadMonth();
  } finally {
    state.submitting = false;
    renderForm();
    renderMonth();
    renderList();
  }
}

function handleEdit(transaction) {
  state.editing = transaction;
  state.formError = null;
  state.formResetKey += 1;
  renderForm();
  renderList();
}

function handleCancelEdit() {
  resetForm();
  renderForm();
  renderList();
}

async function handleDelete(transaction) {
  const t = transaction;
  if (!window.confirm(`${t.date} ${t.category} ${formatWon(t.amount)} 내역을 삭제할까요?`)) return;

  state.deletingId = t.id;
  renderList();
  try {
    await api.deleteTransaction(t.id);
    if (state.editing && state.editing.id === t.id) {
      resetForm();
      renderForm();
    }
    state.deletingId = null;
    loadMonth();
  } catch (error) {
    state.deletingId = null;
    renderList();
    window.alert(error.message);
    if (error.code === "TRANSACTION_NOT_FOUND") loadMonth();
  }
}

// --- 분류 관리 (v0.4) · 예산 (v0.10) ---

async function runCategoryAction(action) {
  if (state.categoryBusy) return;
  state.categoryBusy = true;
  state.categoryError = null;
  renderCategories();
  try {
    await action();
  } catch (error) {
    state.categoryError = error;
    if (error.code === "CATEGORY_NOT_FOUND") {
      state.renamingCategoryId = null;
      state.budgetEditingId = null;
      loadCategories();
    }
  } finally {
    state.categoryBusy = false;
    renderCategories();
  }
}

function showCategoryError(message) {
  state.categoryError = { code: "CLIENT_VALIDATION", message };
  renderCategories();
}

function handleAddCategory({ type, name }) {
  const message = validateCategoryName(name);
  if (message) return showCategoryError(message);
  return runCategoryAction(async () => {
    await api.createCategory({ type, name: name.trim() });
    state.categoryResetKey += 1;
    loadCategories();
  });
}

function handleStartRenameCategory(category) {
  state.renamingCategoryId = category.id;
  state.budgetEditingId = null;
  state.categoryError = null;
  renderCategories();
}

function handleCancelRenameCategory() {
  state.renamingCategoryId = null;
  state.categoryError = null;
  renderCategories();
}

function handleRenameCategory(category, name) {
  const message = validateCategoryName(name);
  if (message) return showCategoryError(message);
  return runCategoryAction(async () => {
    const newName = name.trim();
    await api.renameCategory(category.id, newName);
    state.renamingCategoryId = null;
    // 필터로 고른 분류의 이름이 바뀌면 필터도 새 이름을 따른다.
    const { filters } = state;
    if (filters.category && filters.type === category.type && filters.category === category.name) {
      state.filters = { ...filters, category: newName };
    }
    // 이름이 바뀌면 거래·분류별 지출·예산·고정 거래에 보이는 분류 이름도 바뀐다.
    loadCategories();
    loadTransactions();
    loadFilterSummary();
    loadCategorySpending();
    loadBudgets();
    loadRecurring();
  });
}

function handleDeleteCategory(category) {
  if (state.categoryBusy) return;
  if (!window.confirm(`'${category.name}'(${TYPE_LABELS[category.type]}) 분류를 삭제할까요?`)) return;
  return runCategoryAction(async () => {
    await api.deleteCategory(category.id);
    if (state.renamingCategoryId === category.id) state.renamingCategoryId = null;
    if (state.budgetEditingId === category.id) state.budgetEditingId = null;
    loadCategories();
    loadBudgets();
    loadCategorySpending();
  });
}

function handleStartBudget(category) {
  state.budgetEditingId = category.id;
  state.renamingCategoryId = null;
  state.categoryError = null;
  renderCategories();
}

function handleCancelBudget() {
  state.budgetEditingId = null;
  state.categoryError = null;
  renderCategories();
}

function handleSaveBudget(category, text) {
  const amount = parseAmount(text);
  const message = validateAmount(amount);
  if (message) return showCategoryError(message);
  return runCategoryAction(async () => {
    await api.setBudget(category.id, amount);
    state.budgetEditingId = null;
    loadBudgets();
    loadCategorySpending();
  });
}

function handleDeleteBudget(category) {
  return runCategoryAction(async () => {
    await api.deleteBudget(category.id);
    state.budgetEditingId = null;
    loadBudgets();
    loadCategorySpending();
  });
}

// --- 고정 거래 (v0.11) ---

async function runRecurringAction(action) {
  if (state.recurringBusy) return;
  state.recurringBusy = true;
  state.recurringError = null;
  renderRecurring();
  try {
    await action();
  } catch (error) {
    state.recurringError = error;
    if (error.code === "RECURRING_NOT_FOUND") {
      state.recurringEditing = null;
      state.recurringResetKey += 1;
      loadRecurring();
    }
  } finally {
    state.recurringBusy = false;
    renderRecurring();
  }
}

function handleSubmitRecurring(input) {
  const message = validateRecurringInput(input);
  if (message) {
    state.recurringError = { code: "CLIENT_VALIDATION", message };
    renderRecurring();
    return;
  }
  const editing = state.recurringEditing;
  return runRecurringAction(async () => {
    if (editing) await api.updateRecurring(editing.id, input);
    else await api.createRecurring(input);
    state.recurringEditing = null;
    state.recurringResetKey += 1;
    loadRecurring();
  });
}

function handleEditRecurring(item) {
  state.recurringEditing = item;
  state.recurringError = null;
  state.recurringResetKey += 1;
  renderRecurring();
}

function handleCancelRecurring() {
  state.recurringEditing = null;
  state.recurringError = null;
  state.recurringResetKey += 1;
  renderRecurring();
}

function handleDeleteRecurring(item) {
  if (state.recurringBusy) return;
  const message = `매달 ${item.day}일 ${item.category} ${formatWon(item.amount)} 고정 거래를 삭제할까요? (이미 추가된 거래는 남습니다)`;
  if (!window.confirm(message)) return;
  return runRecurringAction(async () => {
    await api.deleteRecurring(item.id);
    if (state.recurringEditing && state.recurringEditing.id === item.id) {
      state.recurringEditing = null;
      state.recurringResetKey += 1;
    }
    loadRecurring();
  });
}

async function handleApplyRecurring(pending) {
  if (state.applyingRecurring || pending === 0) return;
  const { year, month } = state.selected;
  if (!window.confirm(`${year}년 ${month}월에 고정 거래 ${pending}건을 추가할까요?`)) return;
  state.applyingRecurring = true;
  renderList();
  try {
    await api.applyRecurring({ year, month });
    loadMonth();
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.applyingRecurring = false;
    renderList();
  }
}

// --- 백업 (v0.5) ---

async function handleBackup() {
  if (state.backingUp) return;
  state.backingUp = true;
  renderBackup();
  try {
    const { blob, filename } = await api.downloadBackup();
    saveBlob(blob, filename);
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.backingUp = false;
    renderBackup();
  }
}

renderBackup();
renderMonth();
renderForm();
renderCategories();
renderRecurring();
loadCategories();
loadBudgets();
loadMonth();
