// 날짜·금액 표시와 계산

export const TYPE_LABELS = { income: "수입", expense: "지출" };
export const MIN_MONTH = { year: 1, month: 1 };
export const MAX_MONTH = { year: 9999, month: 12 };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function currentYearMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** 연·월을 delta개월 옮긴다. 1월의 이전 달은 전년 12월이다. */
export function shiftMonth({ year, month }, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function sameMonth(a, b) {
  return a.year === b.year && a.month === b.month;
}

export function formatWon(amount) {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** 수입은 +, 지출은 −를 붙여 표시한다. 색을 구분하기 어려운 사용자도 알아볼 수 있게 한다. */
export function formatSignedWon(type, amount) {
  return `${type === "income" ? "+" : "−"}${formatWon(amount)}`;
}

/** 금액 입력칸의 글자를 숫자로 바꾼다. 비었으면 null. 콤마는 무시한다. */
export function parseAmount(text) {
  const trimmed = String(text).replace(/,/g, "").trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** 숫자만 있으면 천 단위 콤마를 넣는다. 다른 글자가 섞이면 저장할 때 오류로 안내하도록 그대로 둔다. */
export function formatAmountText(text) {
  const raw = String(text);
  const digits = raw.replace(/,/g, "");
  return /^\d+$/.test(digits) ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : raw;
}

/** 거래일 문자열을 `11월 2일 (월)`로 바꾼다. */
export function formatDateHeading(date) {
  const [year, month, day] = date.split("-").map(Number);
  // new Date(50, ...)는 1950년이 되므로 연도는 따로 넣는다.
  const d = new Date(2000, 0, 1);
  d.setFullYear(year, month - 1, day);
  return `${month}월 ${day}일 (${WEEKDAYS[d.getDay()]})`;
}

/** 서버가 정렬한 순서를 유지한 채 날짜별로 묶는다. */
export function groupByDate(transactions) {
  const groups = new Map();
  for (const transaction of transactions) {
    if (!groups.has(transaction.date)) groups.set(transaction.date, []);
    groups.get(transaction.date).push(transaction);
  }
  return [...groups.entries()].map(([date, rows]) => ({ date, rows }));
}

export function fileTimestamp() {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${date}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
