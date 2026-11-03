import { useState } from "react";

import { TYPE_LABELS, formatAmountText, formatWon } from "../lib/format.js";
import AmountInput from "./AmountInput.jsx";
import StatusMessage from "./StatusMessage.jsx";

function RenameForm({ category, busy, onRename, onCancel }) {
  const [name, setName] = useState(category.name);
  return (
    <li>
      <form
        className="category-item is-renaming"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onRename(category, name);
        }}
      >
        <input
          type="text"
          className="rename-input"
          value={name}
          disabled={busy}
          aria-label={`'${category.name}' 새 이름`}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="item-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            저장
          </button>
          <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>
            취소
          </button>
        </div>
      </form>
    </li>
  );
}

function BudgetForm({ category, budget, busy, onSave, onDelete, onCancel }) {
  const [amount, setAmount] = useState(budget === null ? "" : formatAmountText(budget));
  return (
    <li>
      <form
        className="category-item is-budgeting"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSave(category, amount);
        }}
      >
        <span className="category-name">{category.name}</span>
        <AmountInput className="budget-input" placeholder="월 예산" value={amount} disabled={busy} aria-label={`'${category.name}' 월 예산`} onChange={setAmount} />
        <div className="item-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            저장
          </button>
          {budget !== null && (
            <button type="button" className="button-danger" disabled={busy} onClick={() => onDelete(category)}>
              해제
            </button>
          )}
          <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>
            취소
          </button>
        </div>
      </form>
    </li>
  );
}

function CategoryItem({ category, budget, busy, onStartBudget, onStartRename, onDelete }) {
  const isExpense = category.type === "expense";
  return (
    <li className="category-item">
      <span className="category-name">{category.name}</span>
      {category.is_default && <span className="badge">기본</span>}
      {isExpense && budget !== null && <span className="budget-label">{`예산 ${formatWon(budget)}`}</span>}
      {(isExpense || !category.is_default) && (
        <div className="item-actions">
          {isExpense && (
            <button type="button" className="button-secondary" disabled={busy} onClick={() => onStartBudget(category)}>
              예산
            </button>
          )}
          {!category.is_default && (
            <>
              <button type="button" className="button-secondary" disabled={busy} onClick={() => onStartRename(category)}>
                수정
              </button>
              <button type="button" className="button-danger" disabled={busy} onClick={() => onDelete(category)}>
                삭제
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** 입력값은 이 컴포넌트의 상태다. resetKey가 바뀌면 부모가 key로 새로 만들어 비운다. */
function AddForm({ busy, onAdd }) {
  const [type, setType] = useState("expense");
  const [name, setName] = useState("");
  return (
    <form
      className="category-add"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onAdd({ type, name });
      }}
    >
      <fieldset className="field type-field">
        <legend>분류 추가</legend>
        {["expense", "income"].map((value) => (
          <label key={value} className="radio">
            <input type="radio" name="categoryType" value={value} checked={type === value} disabled={busy} onChange={() => setType(value)} /> {TYPE_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <div className="category-add-row">
        <input type="text" name="name" value={name} disabled={busy} aria-label="새 분류 이름" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? "추가 중..." : "추가"}
        </button>
      </div>
    </form>
  );
}

export default function CategoryManager(props) {
  const { categories, budgets, busy, error, renamingId, budgetEditingId, resetKey, onAdd, onRetry } = props;
  const budgetByCategory = new Map(budgets.status === "success" ? budgets.data.map((b) => [b.category_id, b.amount]) : []);

  let groups;
  if (categories.status === "loading") {
    groups = <StatusMessage kind="loading" message="분류를 불러오는 중..." />;
  } else if (categories.status === "error") {
    groups = <StatusMessage kind="error" message={categories.error.message} onRetry={onRetry} />;
  } else {
    groups = (
      <div className="category-groups">
        {["expense", "income"].map((type) => (
          <div key={type} className="category-group">
            <h3 className={type}>{`${TYPE_LABELS[type]} 분류`}</h3>
            <ul className="category-list">
              {categories.data[type].map((category) => {
                const budget = budgetByCategory.has(category.id) ? budgetByCategory.get(category.id) : null;
                if (category.id === renamingId) {
                  return <RenameForm key={category.id} category={category} busy={busy} onRename={props.onRename} onCancel={props.onCancelRename} />;
                }
                if (category.id === budgetEditingId) {
                  return (
                    <BudgetForm
                      key={category.id}
                      category={category}
                      budget={budget}
                      busy={busy}
                      onSave={props.onSaveBudget}
                      onDelete={props.onDeleteBudget}
                      onCancel={props.onCancelBudget}
                    />
                  );
                }
                return (
                  <CategoryItem
                    key={category.id}
                    category={category}
                    budget={budget}
                    busy={busy}
                    onStartBudget={props.onStartBudget}
                    onStartRename={props.onStartRename}
                    onDelete={props.onDelete}
                  />
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section id="category-manager" className="card" aria-label="분류 관리">
      <h2>분류 관리</h2>
      {error && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      {groups}
      <AddForm key={resetKey} busy={busy} onAdd={onAdd} />
    </section>
  );
}
