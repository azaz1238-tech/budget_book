import { formatWon, percent } from "../lib/format.js";
import StatusMessage from "./StatusMessage.jsx";

const WARN_RATIO = 0.8;

function SpendingItem({ item, total, onSelect }) {
  const hasBudget = item.budget !== null;
  const over = hasBudget && item.remaining < 0;
  const warn = hasBudget && !over && item.amount / item.budget >= WARN_RATIO;
  const level = over ? " is-over" : warn ? " is-warn" : "";
  // 예산이 있으면 예산 대비, 없으면 그 달 지출 합계 대비 막대 길이
  const ratio = hasBudget ? Math.min(item.amount / item.budget, 1) : total > 0 ? item.amount / total : 0;
  const budgetLine = hasBudget
    ? `예산 ${formatWon(item.budget)} · ${percent(item.amount, item.budget)}% 사용 · ${over ? `${formatWon(-item.remaining)} 초과` : `${formatWon(item.remaining)} 남음`}`
    : null;
  return (
    <li className="spending-item">
      <button type="button" className="spending-button" aria-label={`${item.category} 거래 보기`} onClick={() => onSelect(item.category)}>
        <span className="spending-head">
          <span className="spending-name">{item.category}</span>
          <span className="spending-meta">{`${item.count}건 · ${percent(item.amount, total)}%`}</span>
          <span className="spending-amount">{formatWon(item.amount)}</span>
        </span>
        <span className="spending-bar">
          <span className={`spending-fill${level}`} style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
        </span>
        {budgetLine && <span className={`spending-budget${level}`}>{budgetLine}</span>}
      </button>
    </li>
  );
}

export default function CategorySpending({ spending, selected, onRetry, onSelect }) {
  let body;
  if (spending.status === "loading") {
    body = <StatusMessage kind="loading" message="분류별 지출을 불러오는 중..." />;
  } else if (spending.status === "error") {
    body = <StatusMessage kind="error" message={spending.error.message} onRetry={onRetry} />;
  } else if (spending.data.items.length === 0) {
    body = <StatusMessage kind="empty" message={`${selected.year}년 ${selected.month}월에는 지출이 없습니다.`} />;
  } else {
    const { total, items } = spending.data;
    body = (
      <ul className="spending-list">
        {items.map((item) => (
          <SpendingItem key={item.category} item={item} total={total} onSelect={onSelect} />
        ))}
      </ul>
    );
  }
  return (
    <section id="category-spending" className="card" aria-label="분류별 지출">
      <h2>분류별 지출</h2>
      {body}
    </section>
  );
}
