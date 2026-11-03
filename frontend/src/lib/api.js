// API 호출 (docs/API_SPEC.md)

import { fileTimestamp } from "./format.js";

const CONNECTION_ERROR = { code: "CONNECTION_ERROR", message: "서버에 연결할 수 없습니다." };

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

/** 파일을 받아 { blob, filename }으로 돌려준다. 파일 이름은 응답 헤더를 따른다. */
async function requestFile(url, fallbackFilename) {
  const res = await fetchOrThrow(url, { method: "GET" });
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  let blob;
  try {
    blob = await res.blob();
  } catch {
    throw CONNECTION_ERROR;
  }
  return { blob, filename: match ? match[1] : fallbackFilename };
}

/** 백업 파일을 요청 본문 그대로 보낸다 (TRD 15.4절). */
async function requestRestore(file) {
  const res = await fetchOrThrow("/api/restore", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  return res.json();
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

export const api = {
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
  restoreTransaction: (transaction) => request("POST", "/api/transactions/restore", transaction),
  downloadBackup: () => requestFile("/api/backup", `budget-backup-${fileTimestamp()}.db`),
  downloadCsv: () => requestFile("/api/export/transactions.csv", `budget-transactions-${fileTimestamp()}.csv`),
  restoreBackup: requestRestore,
};
