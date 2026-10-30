"use strict";

// 화면 컴포넌트 명세: docs/COMPONENT_SPEC.md

const TYPE_LABELS = { income: "수입", expense: "지출" };
const CONNECTION_ERROR = { code: "CONNECTION_ERROR", message: "서버에 연결할 수 없습니다." };

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

function formatWon(amount) {
  return `${amount.toLocaleString("ko-KR")}원`;
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

async function request(method, url, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw CONNECTION_ERROR;
  }
  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  const error = data && data.error;
  if (!res.ok && error && typeof error.code === "string" && typeof error.message === "string") {
    throw { status: res.status, code: error.code, message: error.message };
  }
  if (!res.ok || data === null) {
    throw {
      status: res.status,
      code: "UNKNOWN_ERROR",
      message: `알 수 없는 오류가 발생했습니다. (상태 코드: ${res.status})`,
    };
  }
  return data;
}

const api = {
  getCategories: () => request("GET", "/api/categories"),
  listTransactions: ({ year, month }) => request("GET", `/api/transactions?year=${year}&month=${month}`),
  getSummary: ({ year, month }) => request("GET", `/api/summary?year=${year}&month=${month}`),
  createTransaction: (input) => request("POST", "/api/transactions", input),
  updateTransaction: (id, input) => request("PUT", `/api/transactions/${id}`, input),
  deleteTransaction: (id) => request("DELETE", `/api/transactions/${id}`),
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
// MonthSelector
// ---------------------------------------------------------------------------

function renderMonthSelector(container, { value, disabled, onChange }) {
  const current = `${value.year}-${pad2(value.month)}`;
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

  const names = categories.data[type];
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
  const amountText = form.elements.amount.value.trim();
  const category = form.elements.category;
  return {
    date: form.elements.date.value,
    type: form.elements.type.value,
    amount: amountText === "" ? null : Number(amountText),
    category: category ? category.value : "",
    memo: form.elements.memo.value.trim() || null,
  };
}

/** 클라이언트 검사. 문구는 서버 message와 같게 맞춘다. */
function validateTransactionInput(input) {
  if (!input.date) return "거래일을 입력해 주세요.";
  if (input.amount === null) return "금액을 입력해 주세요.";
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) return "금액은 1 이상의 정수여야 합니다.";
  if (!input.category) return "분류를 선택해 주세요.";
  return null;
}

// ---------------------------------------------------------------------------
// TransactionList / TransactionItem
// ---------------------------------------------------------------------------

function renderTransactionList(container, { transactions, selected, editingId, deletingId, onEdit, onDelete, onRetry }) {
  let body;
  if (transactions.status === "loading") {
    body = StatusMessage({ kind: "loading", message: "거래 내역을 불러오는 중..." });
  } else if (transactions.status === "error") {
    body = StatusMessage({ kind: "error", message: transactions.error.message, onRetry });
  } else if (transactions.data.length === 0) {
    body = StatusMessage({ kind: "empty", message: `${selected.year}년 ${selected.month}월에는 거래 내역이 없습니다.` });
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
  container.replaceChildren(el("h2", { text: "거래 내역" }), body);
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
// App
// ---------------------------------------------------------------------------

const dom = {
  month: document.getElementById("month-selector"),
  summary: document.getElementById("summary-panel"),
  form: document.getElementById("transaction-form"),
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
};

// 응답이 늦게 도착해 최신 상태를 덮어쓰지 않도록 요청마다 번호를 붙인다.
const latestRequest = { categories: 0, transactions: 0, summary: 0 };

function renderMonth() {
  renderMonthSelector(dom.month, { value: state.selected, disabled: state.submitting, onChange: handleMonthChange });
}

function renderSummary() {
  renderSummaryPanel(dom.summary, { summary: state.summary, onRetry: loadSummary });
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

function renderList() {
  renderTransactionList(dom.list, {
    transactions: state.transactions,
    selected: state.selected,
    editingId: state.editing ? state.editing.id : null,
    deletingId: state.deletingId,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onRetry: loadTransactions,
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

function loadCategories() {
  return load("categories", api.getCategories, renderForm);
}

function loadTransactions() {
  const selected = { ...state.selected };
  return load("transactions", () => api.listTransactions(selected), renderList);
}

function loadSummary() {
  const selected = { ...state.selected };
  return load("summary", () => api.getSummary(selected), renderSummary);
}

function loadMonth() {
  return Promise.all([loadTransactions(), loadSummary()]);
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

renderMonth();
renderForm();
loadCategories();
loadMonth();
