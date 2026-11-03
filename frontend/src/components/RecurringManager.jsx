import { useState } from "react";

import { TYPE_LABELS, formatAmountText, formatWon, parseAmount } from "../lib/format.js";
import AmountInput from "./AmountInput.jsx";
import StatusMessage from "./StatusMessage.jsx";

function recurringLabel(item) {
  const parts = [`매달 ${item.day}일`, TYPE_LABELS[item.type], item.category, formatWon(item.amount)];
  if (item.memo) parts.push(item.memo);
  return parts.join(" · ");
}

function RecurringItem({ item, busy, isEditing, onEdit, onDelete }) {
  return (
    <li className={`recurring-item${isEditing ? " is-editing" : ""}`}>
      <div className="recurring-main">
        <span className={`item-type ${item.type}`}>{TYPE_LABELS[item.type]}</span>
        <span className="recurring-text">{recurringLabel(item)}</span>
        {item.day >= 29 && <span className="badge">없는 달은 말일</span>}
      </div>
      <div className="item-actions">
        <button type="button" className="button-secondary" disabled={busy} onClick={() => onEdit(item)}>
          수정
        </button>
        <button type="button" className="button-danger" disabled={busy} onClick={() => onDelete(item)}>
          삭제
        </button>
      </div>
    </li>
  );
}

/** 입력값은 이 컴포넌트의 상태다. resetKey가 바뀌면 부모가 key로 새로 만들어 다시 채운다. */
function RecurringForm({ editing, categories, busy, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => ({
    day: editing ? String(editing.day) : "",
    type: editing ? editing.type : "expense",
    amount: editing ? formatAmountText(editing.amount) : "",
    categoryId: editing ? String(editing.category_id) : "",
    memo: editing ? editing.memo || "" : "",
  }));
  const set = (field) => (value) => setValues((current) => ({ ...current, [field]: value }));
  const isEditing = editing !== null;

  const options = categories.status === "success" ? categories.data[values.type] : [];
  const categoryValue = options.some((c) => String(c.id) === values.categoryId) ? values.categoryId : "";

  const handleSubmit = (event) => {
    event.preventDefault();
    const dayText = values.day.trim();
    onSubmit({
      day: dayText === "" ? null : Number(dayText),
      type: values.type,
      amount: parseAmount(values.amount),
      category_id: categoryValue === "" ? null : Number(categoryValue),
      memo: values.memo.trim() || null,
    });
  };

  const submitText = busy ? "저장 중..." : isEditing ? "수정 저장" : "추가";

  return (
    <form className="recurring-form" noValidate onSubmit={handleSubmit}>
      <h3 className="recurring-form-title">{isEditing ? "고정 거래 수정" : "고정 거래 추가"}</h3>
      <fieldset className="field type-field">
        <legend>유형</legend>
        {["expense", "income"].map((type) => (
          <label key={type} className="radio">
            <input
              type="radio"
              name="recurringType"
              value={type}
              checked={values.type === type}
              onChange={() => setValues((current) => ({ ...current, type, categoryId: "" }))}
            />{" "}
            {TYPE_LABELS[type]}
          </label>
        ))}
      </fieldset>
      <label className="field">
        매달 날짜
        <input
          type="number"
          name="day"
          min="1"
          max="31"
          step="1"
          inputMode="numeric"
          value={values.day}
          placeholder="1 ~ 31"
          onChange={(e) => set("day")(e.target.value)}
        />
      </label>
      <label className="field">
        금액
        <AmountInput name="amount" value={values.amount} onChange={set("amount")} />
      </label>
      <div className="field recurring-category-field">
        <label>
          분류
          <select name="category_id" disabled={categories.status !== "success"} value={categoryValue} onChange={(e) => set("categoryId")(e.target.value)}>
            <option value="">{categories.status === "loading" ? "분류를 불러오는 중..." : "분류 선택"}</option>
            {options.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        메모
        <input type="text" name="memo" value={values.memo} onChange={(e) => set("memo")(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={busy || categories.status !== "success"}>
          {submitText}
        </button>
        <button type="button" className="button-secondary cancel-button" disabled={busy} onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}

export default function RecurringManager(props) {
  const { recurring, categories, editing, formOpen, busy, error, resetKey, onStartAdd, onSubmit, onCancelEdit, onEdit, onDelete, onRetry } = props;

  let list;
  if (recurring.status === "loading") {
    list = <StatusMessage kind="loading" message="고정 거래를 불러오는 중..." />;
  } else if (recurring.status === "error") {
    list = <StatusMessage kind="error" message={recurring.error.message} onRetry={onRetry} />;
  } else if (recurring.data.length === 0) {
    list = <StatusMessage kind="empty" message="등록된 고정 거래가 없습니다." />;
  } else {
    list = (
      <ul className="recurring-list">
        {recurring.data.map((item) => (
          <RecurringItem key={item.id} item={item} busy={busy} isEditing={editing !== null && editing.id === item.id} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </ul>
    );
  }

  return (
    <section id="recurring-manager" className="card" aria-label="고정 거래">
      <h2>고정 거래</h2>
      {error && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      {list}
      {formOpen ? (
        <RecurringForm key={resetKey} editing={editing} categories={categories} busy={busy} onSubmit={onSubmit} onCancel={onCancelEdit} />
      ) : (
        <button type="button" className="button-secondary recurring-add-button" disabled={busy} onClick={onStartAdd}>
          고정 거래 추가
        </button>
      )}
    </section>
  );
}
