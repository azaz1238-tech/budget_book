import { formatWon } from "../lib/format.js";
import StatusMessage from "./StatusMessage.jsx";

export default function SummaryPanel({ summary, hidden, onRetry }) {
  let body;
  if (summary.status === "loading") {
    body = <StatusMessage kind="loading" message="월별 요약을 불러오는 중..." />;
  } else if (summary.status === "error") {
    body = <StatusMessage kind="error" message={summary.error.message} onRetry={onRetry} />;
  } else {
    const { income, expense, balance } = summary.data;
    body = (
      <dl className="summary">
        <div>
          <dt>수입</dt>
          <dd className="income">{formatWon(income)}</dd>
        </div>
        <div>
          <dt>지출</dt>
          <dd className="expense">{formatWon(expense)}</dd>
        </div>
        <div>
          <dt>잔액</dt>
          <dd>{formatWon(balance)}</dd>
        </div>
      </dl>
    );
  }
  return (
    <section id="summary-panel" aria-label="월별 요약" hidden={hidden}>
      <h2>월별 요약</h2>
      {body}
    </section>
  );
}
