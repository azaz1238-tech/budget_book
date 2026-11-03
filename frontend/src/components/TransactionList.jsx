import { TYPE_LABELS, formatDateHeading, formatSignedWon, formatWon, groupByDate } from "../lib/format.js";
import { MAX_KEYWORD_LENGTH } from "../lib/validation.js";
import StatusMessage from "./StatusMessage.jsx";

export const EMPTY_FILTERS = { type: null, category: null, q: null };

export function hasFilters(filters) {
  return Boolean(filters.type || filters.category || filters.q);
}

function TransactionFilters({ categories, filters, open, qDraft, onQDraftChange, onChange, onInvalid }) {
  const handleTypeChange = (event) => {
    const type = event.target.value || null;
    // 유형이 바뀌면 지금 고른 분류는 그 유형에 없으므로 해제한다.
    onChange({ ...filters, type, category: type && type === filters.type ? filters.category : null });
  };

  const handleCategoryChange = (event) => {
    const { value } = event.target;
    if (!value) return onChange({ ...filters, category: null });
    const split = value.indexOf(":");
    return onChange({ ...filters, type: value.slice(0, split), category: value.slice(split + 1) });
  };

  const handleSearch = (event) => {
    event.preventDefault();
    const q = qDraft.trim();
    if ([...q].length > MAX_KEYWORD_LENGTH) return onInvalid(`검색어는 ${MAX_KEYWORD_LENGTH}자 이하여야 합니다.`);
    return onChange({ ...filters, q: q || null });
  };

  const handleReset = () => {
    onQDraftChange("");
    onChange({ ...EMPTY_FILTERS });
  };

  const current = filters.category ? `${filters.type}:${filters.category}` : "";
  const options = (type) =>
    categories.data[type].map((c) => (
      <option key={c.name} value={`${type}:${c.name}`}>
        {c.name}
      </option>
    ));
  let categoryOptions = null;
  let known = false;
  if (categories.status === "success") {
    known = (filters.type ? [filters.type] : ["expense", "income"]).some((type) =>
      categories.data[type].some((c) => `${type}:${c.name}` === current),
    );
    categoryOptions = filters.type
      ? options(filters.type)
      : ["expense", "income"].map((type) => (
          <optgroup key={type} label={TYPE_LABELS[type]}>
            {options(type)}
          </optgroup>
        ));
  }

  // 접혀 있어도 입력 중인 검색어를 유지하도록 숨기기만 한다.
  return (
    <div className="list-filters" hidden={!open}>
      <label className="filter-field">
        <span>유형</span>
        <select className="filter-type" aria-label="유형 필터" value={filters.type || ""} onChange={handleTypeChange}>
          <option value="">전체</option>
          <option value="expense">지출</option>
          <option value="income">수입</option>
        </select>
      </label>
      <label className="filter-field">
        <span>분류</span>
        <select className="filter-select" aria-label="분류 필터" value={current} onChange={handleCategoryChange}>
          <option value="">전체 분류</option>
          {categoryOptions}
          {/* 분류 목록을 불러오는 중이어도 선택한 분류가 보이게 한다. */}
          {current && !known && <option value={current}>{filters.category}</option>}
        </select>
      </label>
      <form className="filter-search" noValidate onSubmit={handleSearch}>
        <input
          type="search"
          className="filter-q"
          value={qDraft}
          placeholder="메모 검색"
          aria-label="메모 검색어"
          onChange={(e) => onQDraftChange(e.target.value)}
        />
        <button type="submit" className="button-secondary">
          검색
        </button>
      </form>
      <button type="button" className="button-secondary filter-reset" disabled={!hasFilters(filters)} onClick={handleReset}>
        필터 초기화
      </button>
    </div>
  );
}

/** 조건이 있을 때 결과 건수와 합계 한 줄. 유형이 정해지면 그 유형 합계만 보여 준다. */
function FilterResult({ filters, transactions, filterSummary }) {
  if (!hasFilters(filters)) return null;
  if (filterSummary && filterSummary.status === "error") {
    return <p className="filter-total is-error">{filterSummary.error.message}</p>;
  }
  const typeClass = filters.type ? ` ${filters.type}` : "";
  if (transactions.status !== "success" || !filterSummary || filterSummary.status !== "success") {
    return <p className={`filter-total${typeClass}`}>검색 결과 · 합계 계산 중...</p>;
  }
  const { income, expense } = filterSummary.data;
  const sums = filters.type
    ? [`${TYPE_LABELS[filters.type]} ${formatWon(filterSummary.data[filters.type])}`]
    : [`수입 ${formatWon(income)}`, `지출 ${formatWon(expense)}`];
  return <p className={`filter-total${typeClass}`}>{["검색 결과", `${transactions.data.length}건`, ...sums].join(" · ")}</p>;
}

/** 고정 거래가 없거나 확인 중이면 목록 위 자리를 차지하지 않는다. */
function RecurringApplyButton({ recurring, applying, onApply }) {
  if (recurring.status === "loading" || (recurring.status === "success" && recurring.data.length === 0)) return null;
  let text;
  let pending = 0;
  if (recurring.status === "error") text = "고정 거래를 확인하지 못했습니다";
  else {
    pending = recurring.data.filter((item) => !item.applied).length;
    text = pending ? `이번 달 고정 거래 불러오기 (${pending}건)` : "고정 거래를 모두 불러왔습니다";
  }
  return (
    <div className="recurring-apply-row">
      <button type="button" className="button-secondary recurring-apply" disabled={applying || pending === 0} onClick={() => onApply(pending)}>
        {applying ? "불러오는 중..." : text}
      </button>
    </div>
  );
}

function TransactionItem({ transaction: t, onEdit }) {
  return (
    <li className="transaction-row">
      <button type="button" className="transaction-item" onClick={() => onEdit(t)}>
        <span className="item-main">
          <span className={`item-type ${t.type}`}>{TYPE_LABELS[t.type]}</span>
          <span className="item-category">{t.category}</span>
          <span className="item-memo">{t.memo || ""}</span>
        </span>
        <span className={`item-amount ${t.type}`}>{formatSignedWon(t.type, t.amount)}</span>
      </button>
    </li>
  );
}

function DateGroup({ date, rows, onEdit }) {
  const total = (type) => rows.filter((t) => t.type === type).reduce((sum, t) => sum + t.amount, 0);
  const expense = total("expense");
  const income = total("income");
  const heading = [formatDateHeading(date), expense ? `지출 ${formatWon(expense)}` : null, income ? `수입 ${formatWon(income)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="date-group">
      <h3 className="date-heading">{heading}</h3>
      <ul className="transaction-list">
        {rows.map((transaction) => (
          <TransactionItem key={transaction.id} transaction={transaction} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  );
}

export default function TransactionList(props) {
  const { transactions, selected, onEdit, onRetry, onAdd, filters, filtersOpen, onToggleFilters } = props;

  let body;
  if (transactions.status === "loading") {
    body = <StatusMessage kind="loading" message="거래 내역을 불러오는 중..." />;
  } else if (transactions.status === "error") {
    body = <StatusMessage kind="error" message={transactions.error.message} onRetry={onRetry} />;
  } else if (transactions.data.length === 0) {
    body = hasFilters(filters) ? (
      <StatusMessage kind="empty" message="조건에 맞는 거래가 없습니다." />
    ) : (
      <StatusMessage
        kind="empty"
        message={`${selected.year}년 ${selected.month}월에는 거래 내역이 없습니다. 첫 거래를 기록해 보세요.`}
        action={{ label: "+ 거래 추가", onClick: onAdd }}
      />
    );
  } else {
    body = (
      <div className="date-groups">
        {groupByDate(transactions.data).map((group) => (
          <DateGroup key={group.date} {...group} onEdit={onEdit} />
        ))}
      </div>
    );
  }

  const toggleText = filtersOpen ? "검색 닫기" : hasFilters(filters) ? "검색 (적용 중)" : "검색";

  return (
    <section id="transaction-list" className="card" aria-label="거래 내역">
      <div className="list-head">
        <h2>거래 내역</h2>
        <button type="button" className="button-secondary filter-toggle" aria-expanded={filtersOpen} onClick={onToggleFilters}>
          {toggleText}
        </button>
      </div>
      <TransactionFilters
        categories={props.categories}
        filters={filters}
        open={filtersOpen}
        qDraft={props.qDraft}
        onQDraftChange={props.onQDraftChange}
        onChange={props.onFiltersChange}
        onInvalid={props.onFilterInvalid}
      />
      {props.filterError && (
        <p className="form-error filter-error" role="alert">
          {props.filterError.message}
        </p>
      )}
      <FilterResult filters={filters} transactions={transactions} filterSummary={props.filterSummary} />
      <RecurringApplyButton recurring={props.recurring} applying={props.applying} onApply={props.onApplyRecurring} />
      {body}
    </section>
  );
}
