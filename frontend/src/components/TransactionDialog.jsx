import { useEffect, useRef, useState } from "react";

import { TYPE_LABELS, formatAmountText, parseAmount, todayString, yesterdayString } from "../lib/format.js";
import AmountInput from "./AmountInput.jsx";
import StatusMessage from "./StatusMessage.jsx";

const QUICK_AMOUNTS = [
  { label: "+1천", value: 1000 },
  { label: "+5천", value: 5000 },
  { label: "+1만", value: 10000 },
  { label: "+5만", value: 50000 },
];

function initialValues(editing, defaults) {
  const values = editing || {
    type: defaults ? defaults.type : "expense",
    date: defaults ? defaults.date : todayString(),
    amount: "",
    category: "",
    memo: "",
  };
  return {
    type: values.type,
    date: values.date,
    amount: formatAmountText(values.amount),
    category: values.category,
    memo: values.memo || "",
  };
}

/** 바꾼 값이 있는지 비교할 입력값 */
function draftKey({ type, date, amount, category, memo }) {
  return JSON.stringify([type, date, amount.replace(/,/g, "").trim(), category, memo.trim()]);
}

function CategoryField({ categories, type, category, onChange, onRetry }) {
  if (categories.status === "loading") {
    return (
      <div className="field category-field">
        <span>분류</span>
        <p className="chips-loading">분류를 불러오는 중...</p>
      </div>
    );
  }
  if (categories.status === "error") {
    return (
      <div className="field category-field">
        <span>분류</span>
        <StatusMessage kind="error" message={categories.error.message} onRetry={onRetry} />
      </div>
    );
  }
  return (
    <div className="field category-field">
      <fieldset className="chips-field">
        <legend>분류</legend>
        <div className="chips">
          {categories.data[type].map(({ name }) => (
            <label key={name} className="chip">
              <input type="radio" name="category" value={name} checked={name === category} onChange={() => onChange(name)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** 입력값은 이 컴포넌트의 상태다. resetKey가 바뀌면 부모가 key로 새로 만들어 다시 채운다. */
function TransactionForm({ categories, editing, defaults, submitting, error, notice, dirtyRef, onSubmit, onCancel, onDelete, onRetryCategories }) {
  const [initial] = useState(() => initialValues(editing, defaults));
  const [values, setValues] = useState(initial);
  const amountRef = useRef(null);
  const isEditing = editing !== null;
  const set = (field) => (value) => setValues((current) => ({ ...current, [field]: value }));

  // App이 Esc를 처리할 때 바꾼 값이 있는지 알 수 있게 한다.
  useEffect(() => {
    dirtyRef.current = draftKey(values) !== draftKey(initial);
    return () => {
      dirtyRef.current = false;
    };
  }, [values, initial, dirtyRef]);

  const handleSubmit = (event) => {
    event.preventDefault();
    // 분류 목록에 없는 분류(이름이 바뀌거나 삭제됨)는 선택하지 않은 것으로 본다.
    const chosen = categories.status === "success" && categories.data[values.type].some((c) => c.name === values.category);
    onSubmit({
      date: values.date,
      type: values.type,
      amount: parseAmount(values.amount),
      category: chosen ? values.category : "",
      memo: values.memo.trim() || null,
    });
  };

  const handleQuickAmount = (amount) => {
    const current = parseAmount(values.amount);
    const next = (Number.isSafeInteger(current) && current > 0 ? current : 0) + amount;
    if (Number.isSafeInteger(next)) set("amount")(formatAmountText(next));
    amountRef.current.focus();
  };

  const submitText = submitting ? "저장 중..." : isEditing ? "수정 저장" : "저장";

  return (
    <form className="transaction-form" noValidate onSubmit={handleSubmit}>
      <h2>{isEditing ? "거래 수정" : "거래 등록"}</h2>
      {notice && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      <fieldset className="field type-field">
        <legend>유형</legend>
        <div className="segmented">
          {["expense", "income"].map((type) => (
            <label key={type} className="segment">
              <input
                type="radio"
                name="type"
                value={type}
                checked={values.type === type}
                // 유형을 바꾸면 분류 선택을 초기화한다.
                onChange={() => setValues((current) => ({ ...current, type, category: "" }))}
              />
              <span>{TYPE_LABELS[type]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label>
          거래일
          <input type="date" name="date" value={values.date} onChange={(e) => set("date")(e.target.value)} />
        </label>
        <div className="shortcuts">
          <button type="button" className="button-secondary shortcut-button" onClick={() => set("date")(todayString())}>
            오늘
          </button>
          <button type="button" className="button-secondary shortcut-button" onClick={() => set("date")(yesterdayString())}>
            어제
          </button>
        </div>
      </div>
      <div className="field">
        <label>
          금액
          <AmountInput name="amount" inputRef={amountRef} value={values.amount} onChange={set("amount")} />
        </label>
        <div className="shortcuts">
          {QUICK_AMOUNTS.map(({ label, value }) => (
            <button key={label} type="button" className="button-secondary shortcut-button" onClick={() => handleQuickAmount(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <CategoryField categories={categories} type={values.type} category={values.category} onChange={set("category")} onRetry={onRetryCategories} />
      <label className="field memo-field">
        메모
        <input type="text" name="memo" value={values.memo} onChange={(e) => set("memo")(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={submitting || categories.status !== "success"}>
          {submitText}
        </button>
        <button type="button" className="button-secondary cancel-button" disabled={submitting} onClick={onCancel}>
          {isEditing ? "취소" : "닫기"}
        </button>
        {isEditing && (
          <button type="button" className="button-danger delete-button" disabled={submitting} onClick={() => onDelete(editing)}>
            삭제
          </button>
        )}
      </div>
    </form>
  );
}

export default function TransactionDialog({ open, resetKey, toastSlotRef, onCloseRequest, onClosed, ...formProps }) {
  const dialogRef = useRef(null);
  const dirtyRef = useRef(false);
  const { editing } = formProps;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    // 새 거래를 입력할 때는 금액칸에서 시작한다. (연속 입력 포함)
    if (open && editing === null) dialog.querySelector('input[name="amount"]').focus();
  }, [open, resetKey, editing]);

  return (
    <dialog
      id="transaction-dialog"
      ref={dialogRef}
      className="sheet-dialog"
      aria-label="거래 입력"
      // Chrome은 연달아 들어온 닫기 요청에 cancel을 보내지 않으므로 Esc는 keydown에서 먼저 막는다 (TRD 15.5절).
      onKeyDown={(event) => {
        if (event.key === "Escape" && onCloseRequest(dirtyRef.current)) event.preventDefault();
      }}
      onCancel={(event) => {
        if (onCloseRequest(dirtyRef.current)) event.preventDefault();
      }}
      onClose={onClosed}
    >
      <div id="transaction-form">{open && <TransactionForm key={resetKey} dirtyRef={dirtyRef} {...formProps} />}</div>
      <div ref={toastSlotRef} />
    </dialog>
  );
}
