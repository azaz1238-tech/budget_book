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

/** 월 조회 쿼리. 분류 필터(v0.6)가 있으면 유형과 분류 이름을 함께 붙인다. */
function monthQuery({ year, month }, filter) {
  const params = new URLSearchParams({ year, month });
  if (filter) {
    params.set("type", filter.type);
    params.set("category", filter.category);
  }
  return params.toString();
}

const api = {
  getCategories: () => request("GET", "/api/categories"),
  listTransactions: (selected, filter) => request("GET", `/api/transactions?${monthQuery(selected, filter)}`),
  getSummary: (selected, filter) => request("GET", `/api/summary?${monthQuery(selected, filter)}`),
  createTransaction: (input) => request("POST", "/api/transactions", input),
  updateTransaction: (id, input) => request("PUT", `/api/transactions/${id}`, input),
  deleteTransaction: (id) => request("DELETE", `/api/transactions/${id}`),
  createCategory: (input) => request("POST", "/api/categories", input),
  renameCategory: (id, name) => request("PUT", `/api/categories/${id}`, { name }),
  deleteCategory: (id) => request("DELETE", `/api/categories/${id}`),
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

function filterLabel(filter) {
  return `'${filter.category}'(${TYPE_LABELS[filter.type]})`;
}

/** 분류 필터 선택 상자 (v0.6). 값은 "유형:분류 이름" 형식이다. */
function FilterSelect({ categories, filter, onFilterChange }) {
  const select = el("select", { className: "filter-select", "aria-label": "분류 필터" }, [
    el("option", { value: "", text: "전체 분류" }),
  ]);
  if (categories.status === "success") {
    for (const type of ["expense", "income"]) {
      select.append(
        el("optgroup", { label: TYPE_LABELS[type] }, categories.data[type].map((c) => el("option", { value: `${type}:${c.name}`, text: c.name }))),
      );
    }
  }
  const current = filter ? `${filter.type}:${filter.category}` : "";
  if (current && ![...select.options].some((option) => option.value === current)) {
    // 분류 목록을 불러오는 중이어도 선택한 필터가 보이게 한다.
    select.append(el("option", { value: current, text: filter.category }));
  }
  select.value = current;
  select.addEventListener("change", () => {
    if (!select.value) return onFilterChange(null);
    const split = select.value.indexOf(":");
    onFilterChange({ type: select.value.slice(0, split), category: select.value.slice(split + 1) });
  });
  return el("label", { className: "list-filter" }, [el("span", { text: "분류 필터" }), select]);
}

/** 필터 적용 시 건수·합계 한 줄 (v0.6). */
function FilterTotal({ filter, transactions, filterSummary }) {
  if (!filter) return null;
  const label = `${filter.category}(${TYPE_LABELS[filter.type]})`;
  if (filterSummary && filterSummary.status === "error") {
    return el("p", { className: "filter-total is-error", text: filterSummary.error.message });
  }
  if (transactions.status !== "success" || !filterSummary || filterSummary.status !== "success") {
    return el("p", { className: `filter-total ${filter.type}`, text: `${label} · 합계 계산 중...` });
  }
  const total = filterSummary.data[filter.type];
  return el("p", {
    className: `filter-total ${filter.type}`,
    text: `${label} · ${transactions.data.length}건 · 합계 ${formatWon(total)}`,
  });
}

function renderTransactionList(container, props) {
  const { transactions, selected, editingId, deletingId, onEdit, onDelete, onRetry, filter } = props;
  let body;
  if (transactions.status === "loading") {
    body = StatusMessage({ kind: "loading", message: "거래 내역을 불러오는 중..." });
  } else if (transactions.status === "error") {
    body = StatusMessage({ kind: "error", message: transactions.error.message, onRetry });
  } else if (transactions.data.length === 0) {
    const what = filter ? `${filterLabel(filter)} 거래가` : "거래 내역이";
    body = StatusMessage({ kind: "empty", message: `${selected.year}년 ${selected.month}월에는 ${what} 없습니다.` });
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
      FilterSelect(props),
      FilterTotal(props),
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
// CategoryManager / CategoryItem (v0.4)
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
 * 다시 그릴 때 입력 중인 값(추가할 이름·유형, 수정 중인 이름)을 유지한다.
 * 추가 입력칸은 resetKey가 바뀔 때만 비운다.
 */
function renderCategoryManager(container, props) {
  const sameKey = container.dataset.resetKey === String(props.resetKey);
  const previousName = container.querySelector(".category-add input[name=name]");
  const previousType = container.querySelector(".category-add input[name=categoryType]:checked");
  const addName = sameKey && previousName ? previousName.value : "";
  const addType = sameKey && previousType ? previousType.value : "expense";

  const previousRename = container.querySelector(".rename-input");
  const renameDraft =
    previousRename && Number(previousRename.dataset.id) === props.renamingId ? previousRename.value : null;

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
                category,
                isRenaming: category.id === props.renamingId,
                renameDraft,
                busy: props.busy,
                onStartRename: props.onStartRename,
                onRename: props.onRename,
                onCancelRename: props.onCancelRename,
                onDelete: props.onDelete,
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

function CategoryItem({ category, isRenaming, renameDraft, busy, onStartRename, onRename, onCancelRename, onDelete }) {
  if (category.is_default) {
    return el("li", { className: "category-item" }, [
      el("span", { className: "category-name", text: category.name }),
      el("span", { className: "badge", text: "기본" }),
    ]);
  }

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
        el("button", { type: "button", className: "button-secondary", text: "취소", disabled: busy, onClick: onCancelRename }),
      ]),
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onRename(category, input.value);
    });
    return el("li", {}, [form]);
  }

  return el("li", { className: "category-item" }, [
    el("span", { className: "category-name", text: category.name }),
    el("div", { className: "item-actions" }, [
      el("button", { type: "button", className: "button-secondary", text: "수정", disabled: busy, onClick: () => onStartRename(category) }),
      el("button", { type: "button", className: "button-danger", text: "삭제", disabled: busy, onClick: () => onDelete(category) }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const dom = {
  backup: document.getElementById("backup-button"),
  month: document.getElementById("month-selector"),
  summary: document.getElementById("summary-panel"),
  form: document.getElementById("transaction-form"),
  categories: document.getElementById("category-manager"),
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
  filter: null,
  filterSummary: null,
};

// 응답이 늦게 도착해 최신 상태를 덮어쓰지 않도록 요청마다 번호를 붙인다.
const latestRequest = { categories: 0, transactions: 0, summary: 0, filterSummary: 0 };

function renderBackup() {
  renderBackupButton(dom.backup, { busy: state.backingUp, onBackup: handleBackup });
}

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

function renderCategories() {
  renderCategoryManager(dom.categories, {
    categories: state.categories,
    busy: state.categoryBusy,
    error: state.categoryError,
    renamingId: state.renamingCategoryId,
    resetKey: state.categoryResetKey,
    onAdd: handleAddCategory,
    onStartRename: handleStartRenameCategory,
    onRename: handleRenameCategory,
    onCancelRename: handleCancelRenameCategory,
    onDelete: handleDeleteCategory,
    onRetry: loadCategories,
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
    filter: state.filter,
    filterSummary: state.filterSummary,
    onFilterChange: handleFilterChange,
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
    renderList();
  });
  // 필터로 고른 분류가 삭제되었으면 필터를 전체로 되돌린다.
  const { filter, categories } = state;
  if (filter && categories.status === "success" && !categories.data[filter.type].some((c) => c.name === filter.category)) {
    handleFilterChange(null);
  }
}

function loadTransactions() {
  const selected = { ...state.selected };
  const filter = state.filter && { ...state.filter };
  return load("transactions", () => api.listTransactions(selected, filter), renderList);
}

function loadSummary() {
  const selected = { ...state.selected };
  return load("summary", () => api.getSummary(selected), renderSummary);
}

/** 필터가 있을 때만 그 분류의 합계를 불러온다. 월별 요약(loadSummary)은 항상 전체 기준이다. */
function loadFilterSummary() {
  if (!state.filter) {
    latestRequest.filterSummary += 1; // 진행 중인 이전 응답이 덮어쓰지 않게 한다
    state.filterSummary = null;
    renderList();
    return Promise.resolve();
  }
  const selected = { ...state.selected };
  const filter = { ...state.filter };
  return load("filterSummary", () => api.getSummary(selected, filter), renderList);
}

function loadMonth() {
  return Promise.all([loadTransactions(), loadSummary(), loadFilterSummary()]);
}

function handleFilterChange(filter) {
  state.filter = filter;
  loadTransactions();
  loadFilterSummary();
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

// --- 분류 관리 (v0.4) ---

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
    if (state.filter && state.filter.type === category.type && state.filter.category === category.name) {
      state.filter = { type: category.type, category: newName };
    }
    // 이름을 바꾸면 그 분류를 쓰던 거래의 분류 이름도 바뀌므로 거래 목록도 다시 불러온다.
    loadCategories();
    loadTransactions();
    loadFilterSummary();
  });
}

function handleDeleteCategory(category) {
  if (state.categoryBusy) return;
  if (!window.confirm(`'${category.name}'(${TYPE_LABELS[category.type]}) 분류를 삭제할까요?`)) return;
  return runCategoryAction(async () => {
    await api.deleteCategory(category.id);
    if (state.renamingCategoryId === category.id) state.renamingCategoryId = null;
    loadCategories();
  });
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
loadCategories();
loadMonth();
