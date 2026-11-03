// 화면 컴포넌트 명세: docs/COMPONENT_SPEC.md

import { useCallback, useEffect, useState } from "react";

import CategoryManager from "./components/CategoryManager.jsx";
import CategorySpending from "./components/CategorySpending.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import DataManager from "./components/DataManager.jsx";
import { MonthNavigator, MonthSelector } from "./components/MonthNavigator.jsx";
import RecurringManager from "./components/RecurringManager.jsx";
import SummaryPanel from "./components/SummaryPanel.jsx";
import TabBar from "./components/TabBar.jsx";
import Toast from "./components/Toast.jsx";
import TransactionDialog from "./components/TransactionDialog.jsx";
import TransactionList, { EMPTY_FILTERS, hasFilters } from "./components/TransactionList.jsx";
import { useCompactHeader } from "./hooks/useCompactHeader.js";
import { useConfirm } from "./hooks/useConfirm.js";
import { useResource } from "./hooks/useResource.js";
import { api } from "./lib/api.js";
import { TYPE_LABELS, currentYearMonth, formatWon, parseAmount, saveBlob } from "./lib/format.js";
import { validateAmount, validateCategoryName, validateRecurringInput, validateTransactionInput } from "./lib/validation.js";

const UNDO_DURATION_MS = 5000;
const TOAST_DURATION_MS = 4000;

export default function App() {
  const [tab, setTab] = useState("list");
  const [selected, setSelected] = useState(currentYearMonth);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const compact = useCompactHeader();
  const { confirm, request: confirmRequest, finish: finishConfirm } = useConfirm();

  // --- 검색·필터 (v0.9) ---
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterError, setFilterError] = useState(null);
  const [qDraft, setQDraft] = useState("");

  // --- 서버 데이터. 월별 요약과 분류별 지출은 필터와 관계없이 그 달 전체 기준이다. ---
  const [categories, reloadCategories] = useResource(api.getCategories, []);
  const [budgets, reloadBudgets] = useResource(api.listBudgets, []);
  const [transactions, reloadTransactions] = useResource(() => api.listTransactions(selected, filters), [selected, filters]);
  const [summary, reloadSummary] = useResource(() => api.getSummary(selected), [selected]);
  const [filterSummary, reloadFilterSummary] = useResource(hasFilters(filters) ? () => api.getSummary(selected, filters) : null, [selected, filters]);
  const [categorySpending, reloadCategorySpending] = useResource(() => api.getCategorySpending(selected), [selected]);
  const [recurring, reloadRecurring] = useResource(() => api.listRecurring(selected), [selected]);

  const reloadMonth = () => {
    reloadTransactions();
    reloadSummary();
    reloadFilterSummary();
    reloadCategorySpending();
    reloadRecurring();
  };

  // --- 거래 입력 창 ---
  const [form, setForm] = useState({ open: false, resetKey: 0, editing: null, defaults: null, error: null, notice: null });
  const [submitting, setSubmitting] = useState(false);

  // --- 분류 관리 (v0.4) · 예산 (v0.10) ---
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState(null);
  const [budgetEditingId, setBudgetEditingId] = useState(null);
  const [categoryResetKey, setCategoryResetKey] = useState(0);

  // --- 고정 거래 (v0.11) ---
  const [recurringEditing, setRecurringEditing] = useState(null);
  const [recurringFormOpen, setRecurringFormOpen] = useState(false);
  const [recurringBusy, setRecurringBusy] = useState(false);
  const [recurringError, setRecurringError] = useState(null);
  const [recurringResetKey, setRecurringResetKey] = useState(0);
  const [applyingRecurring, setApplyingRecurring] = useState(false);

  // --- 백업·CSV·복원 (v0.5, v1.0) ---
  const [dataBusy, setDataBusy] = useState(null);

  // --- 알림 (v1.0): 브라우저 기본 alert를 대신한다. 한 번에 하나만 보이고, 새 알림이 오면 바뀐다. ---
  const [toast, setToast] = useState(null);
  const [formToastSlot, setFormToastSlot] = useState(null);
  const [confirmToastSlot, setConfirmToastSlot] = useState(null);
  const hideToast = useCallback(() => setToast(null), []);
  const showToast = (message, { action = null, duration = TOAST_DURATION_MS, kind = "info", sticky = kind === "error" } = {}) => {
    setToast({ message, action, duration, kind, sticky });
  };
  const showErrorToast = (error) => showToast(error.message, { kind: "error" });

  useEffect(() => {
    if (!toast || toast.sticky) return undefined;
    const timer = setTimeout(hideToast, toast.duration);
    return () => clearTimeout(timer);
  }, [toast, hideToast]);

  // 필터로 고른 분류가 삭제되었으면 유형·분류 조건을 해제한다. 분류 목록을 새로 받았을 때만 확인한다.
  useEffect(() => {
    if (categories.status !== "success" || !filters.category) return;
    if (!categories.data[filters.type].some((c) => c.name === filters.category)) {
      setFilters({ ...filters, type: null, category: null });
      setFilterError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  const handleFiltersChange = (next) => {
    setFilters(next);
    setFilterError(null);
  };

  const handleSpendingSelect = (category) => {
    // 입력 중이던 검색어까지 지워야 고른 분류의 거래가 모두 보인다.
    setQDraft("");
    setTab("list");
    handleFiltersChange({ type: "expense", category, q: null });
  };

  const handleMonthChange = useCallback((value) => {
    setSelected(value);
    setMonthPickerOpen(false);
  }, []);

  // --- 거래 등록·수정·삭제 ---

  const openNewForm = () => {
    setForm((f) => ({ open: true, resetKey: f.resetKey + 1, editing: null, defaults: null, error: null, notice: null }));
  };

  const closeForm = () => {
    setForm((f) => ({ open: false, resetKey: f.resetKey + 1, editing: null, defaults: null, error: null, notice: null }));
  };

  const handleEdit = (transaction) => {
    setForm((f) => ({ ...f, open: true, resetKey: f.resetKey + 1, editing: transaction, error: null, notice: null }));
  };

  const handleSubmit = async (input) => {
    if (submitting) return;

    const message = validateTransactionInput(input);
    if (message) {
      setForm((f) => ({ ...f, notice: null, error: { code: "CLIENT_VALIDATION", message } }));
      return;
    }

    const { editing } = form;
    setSubmitting(true);
    setForm((f) => ({ ...f, error: null, notice: null }));
    try {
      const saved = editing ? await api.updateTransaction(editing.id, input) : await api.createTransaction(input);
      if (editing) {
        closeForm();
        showToast("수정했습니다.");
      } else {
        // 연속 입력: 창을 유지하고 유형과 거래일을 이어 간다.
        setForm((f) => ({
          ...f,
          resetKey: f.resetKey + 1,
          editing: null,
          defaults: { type: input.type, date: input.date },
          error: null,
          notice: "저장했습니다.",
        }));
      }
      // 저장한 거래가 바로 보이도록 그 거래의 연·월로 이동한다.
      const [year, month] = saved.date.split("-").map(Number);
      setSelected({ year, month });
      reloadMonth();
    } catch (error) {
      setForm((f) => ({ ...f, error }));
      if (editing && error.code === "TRANSACTION_NOT_FOUND") reloadMonth();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (t) => {
    const confirmed = await confirm({
      message: `${t.date} ${t.category} ${formatWon(t.amount)} 내역을 삭제할까요?`,
      confirmText: "삭제",
      danger: true,
    });
    if (!confirmed) return;

    try {
      await api.deleteTransaction(t.id);
      closeForm();
      reloadMonth();
      showToast("삭제했습니다.", {
        duration: UNDO_DURATION_MS,
        action: { label: "되돌리기", onClick: () => handleUndoDelete(t) },
      });
    } catch (error) {
      // 수정 창 안에서 시작한 작업이므로 에러도 창 안에 보여 준다.
      setForm((f) => ({ ...f, error }));
      if (error.code === "TRANSACTION_NOT_FOUND") reloadMonth();
    }
  };

  const handleUndoDelete = async (transaction) => {
    try {
      await api.restoreTransaction(transaction);
      reloadMonth();
      showToast("되돌렸습니다.");
    } catch (error) {
      showErrorToast(error);
    }
  };

  /** Esc와 기기의 닫기 요청. 막았으면 true를 돌려준다. 바꾼 값이 있으면 버릴지 묻는다. */
  const handleFormCloseRequest = (dirty) => {
    if (submitting) return true;
    if (!dirty) return false;
    confirm({ message: "입력한 내용을 버리고 닫을까요?", confirmText: "버리기", danger: true }).then((confirmed) => {
      if (confirmed) closeForm();
    });
    return true;
  };

  // --- 분류 관리 · 예산 ---

  const runCategoryAction = async (action) => {
    if (categoryBusy) return;
    setCategoryBusy(true);
    setCategoryError(null);
    try {
      await action();
    } catch (error) {
      setCategoryError(error);
      if (error.code === "CATEGORY_NOT_FOUND") {
        setRenamingCategoryId(null);
        setBudgetEditingId(null);
        reloadCategories();
      }
    } finally {
      setCategoryBusy(false);
    }
  };

  const showCategoryError = (message) => setCategoryError({ code: "CLIENT_VALIDATION", message });

  const handleAddCategory = ({ type, name }) => {
    const message = validateCategoryName(name);
    if (message) return showCategoryError(message);
    return runCategoryAction(async () => {
      await api.createCategory({ type, name: name.trim() });
      setCategoryResetKey((k) => k + 1);
      reloadCategories();
    });
  };

  const handleStartRenameCategory = (category) => {
    setRenamingCategoryId(category.id);
    setBudgetEditingId(null);
    setCategoryError(null);
  };

  const handleCancelCategoryEdit = () => {
    setRenamingCategoryId(null);
    setBudgetEditingId(null);
    setCategoryError(null);
  };

  const handleRenameCategory = (category, name) => {
    const message = validateCategoryName(name);
    if (message) return showCategoryError(message);
    return runCategoryAction(async () => {
      const newName = name.trim();
      await api.renameCategory(category.id, newName);
      setRenamingCategoryId(null);
      // 필터로 고른 분류의 이름이 바뀌면 필터도 새 이름을 따른다.
      if (filters.category && filters.type === category.type && filters.category === category.name) {
        setFilters({ ...filters, category: newName });
      }
      // 이름이 바뀌면 거래·분류별 지출·예산·고정 거래에 보이는 분류 이름도 바뀐다.
      reloadCategories();
      reloadTransactions();
      reloadFilterSummary();
      reloadCategorySpending();
      reloadBudgets();
      reloadRecurring();
    });
  };

  const handleDeleteCategory = async (category) => {
    if (categoryBusy) return;
    const confirmed = await confirm({
      message: `'${category.name}'(${TYPE_LABELS[category.type]}) 분류를 삭제할까요?`,
      confirmText: "삭제",
      danger: true,
    });
    if (!confirmed) return;
    await runCategoryAction(async () => {
      await api.deleteCategory(category.id);
      if (renamingCategoryId === category.id) setRenamingCategoryId(null);
      if (budgetEditingId === category.id) setBudgetEditingId(null);
      reloadCategories();
      reloadBudgets();
      reloadCategorySpending();
    });
  };

  const handleStartBudget = (category) => {
    setBudgetEditingId(category.id);
    setRenamingCategoryId(null);
    setCategoryError(null);
  };

  const handleSaveBudget = (category, text) => {
    const amount = parseAmount(text);
    const message = validateAmount(amount);
    if (message) return showCategoryError(message);
    return runCategoryAction(async () => {
      await api.setBudget(category.id, amount);
      setBudgetEditingId(null);
      reloadBudgets();
      reloadCategorySpending();
    });
  };

  const handleDeleteBudget = (category) =>
    runCategoryAction(async () => {
      await api.deleteBudget(category.id);
      setBudgetEditingId(null);
      reloadBudgets();
      reloadCategorySpending();
    });

  // --- 고정 거래 ---

  const runRecurringAction = async (action) => {
    if (recurringBusy) return;
    setRecurringBusy(true);
    setRecurringError(null);
    try {
      await action();
    } catch (error) {
      setRecurringError(error);
      if (error.code === "RECURRING_NOT_FOUND") {
        setRecurringEditing(null);
        setRecurringResetKey((k) => k + 1);
        reloadRecurring();
      }
    } finally {
      setRecurringBusy(false);
    }
  };

  const closeRecurringForm = () => {
    setRecurringEditing(null);
    setRecurringFormOpen(false);
    setRecurringResetKey((k) => k + 1);
  };

  const handleSubmitRecurring = (input) => {
    const message = validateRecurringInput(input);
    if (message) {
      setRecurringError({ code: "CLIENT_VALIDATION", message });
      return undefined;
    }
    return runRecurringAction(async () => {
      if (recurringEditing) await api.updateRecurring(recurringEditing.id, input);
      else await api.createRecurring(input);
      closeRecurringForm();
      reloadRecurring();
    });
  };

  const openRecurringForm = (item) => {
    setRecurringEditing(item);
    setRecurringFormOpen(true);
    setRecurringError(null);
    setRecurringResetKey((k) => k + 1);
  };

  const handleCancelRecurring = () => {
    closeRecurringForm();
    setRecurringError(null);
  };

  const handleDeleteRecurring = async (item) => {
    if (recurringBusy) return;
    const confirmed = await confirm({
      message: `매달 ${item.day}일 ${item.category} ${formatWon(item.amount)} 고정 거래를 삭제할까요? (이미 추가된 거래는 남습니다)`,
      confirmText: "삭제",
      danger: true,
    });
    if (!confirmed) return;
    await runRecurringAction(async () => {
      await api.deleteRecurring(item.id);
      if (recurringEditing && recurringEditing.id === item.id) closeRecurringForm();
      reloadRecurring();
    });
  };

  const handleApplyRecurring = async (pending) => {
    if (applyingRecurring || pending === 0) return;
    const { year, month } = selected;
    const confirmed = await confirm({ message: `${year}년 ${month}월에 고정 거래 ${pending}건을 추가할까요?`, confirmText: "추가" });
    if (!confirmed) return;
    setApplyingRecurring(true);
    try {
      await api.applyRecurring({ year, month });
      reloadMonth();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setApplyingRecurring(false);
    }
  };

  // --- 백업·CSV·복원 ---

  const handleDownload = async (kind, download) => {
    if (dataBusy) return;
    setDataBusy(kind);
    try {
      const { blob, filename } = await download();
      saveBlob(blob, filename);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setDataBusy(null);
    }
  };

  /** 화면의 모든 상태가 옛 데이터이므로 비우고 새로 불러온다. 탭과 선택한 달은 유지한다. */
  const reloadAfterRestore = () => {
    setQDraft("");
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    setFilterError(null);
    setRenamingCategoryId(null);
    setBudgetEditingId(null);
    setCategoryError(null);
    setCategoryResetKey((k) => k + 1);
    closeRecurringForm();
    setRecurringError(null);
    reloadCategories();
    reloadBudgets();
    reloadMonth();
  };

  const handleRestoreFile = async (file) => {
    if (dataBusy) return;
    const confirmed = await confirm({
      message: `지금 데이터를 '${file.name}'의 내용으로 바꿀까요? 지금 데이터의 사본은 서버 폴더에 남습니다.`,
      confirmText: "복원",
      danger: true,
    });
    if (!confirmed) return;
    setDataBusy("restore");
    try {
      const { transactions: count, safety_copy: safetyCopy } = await api.restoreBackup(file);
      reloadAfterRestore();
      showToast(`복원했습니다. 거래 ${count}건. 복원 전 데이터 사본: ${safetyCopy}`, { sticky: true });
    } catch (error) {
      showErrorToast(error);
    } finally {
      setDataBusy(null);
    }
  };

  const isSettings = tab === "settings";
  const toastHost = (confirmRequest && confirmToastSlot) || (form.open && formToastSlot) || document.body;

  return (
    <>
      <header id="app-header" className={`app-header${compact ? " is-compact" : ""}`}>
        <div className="app-header-inner">
          <div className="title-row">
            <h1>가계부</h1>
            <TabBar tab={tab} onChange={setTab} />
          </div>
          <div id="month-controls" className="month-controls" hidden={isSettings}>
            <MonthNavigator
              value={selected}
              today={currentYearMonth()}
              disabled={submitting}
              pickerOpen={monthPickerOpen}
              onChange={handleMonthChange}
              onTogglePicker={() => setMonthPickerOpen((open) => !open)}
            />
            <div id="month-selector" className="month-selector" hidden={!monthPickerOpen}>
              {monthPickerOpen && <MonthSelector value={selected} disabled={submitting} onChange={handleMonthChange} />}
            </div>
          </div>
          <SummaryPanel summary={summary} hidden={isSettings} onRetry={reloadSummary} />
        </div>
      </header>
      <main className="app">
        <div id="panel-list" hidden={tab !== "list"}>
          <TransactionList
            transactions={transactions}
            selected={selected}
            categories={categories}
            filters={filters}
            filtersOpen={filtersOpen}
            filterError={filterError}
            filterSummary={filterSummary}
            qDraft={qDraft}
            recurring={recurring}
            applying={applyingRecurring}
            onAdd={openNewForm}
            onEdit={handleEdit}
            onRetry={() => {
              reloadTransactions();
              reloadFilterSummary();
            }}
            onToggleFilters={() => setFiltersOpen((open) => !open)}
            onQDraftChange={setQDraft}
            onFiltersChange={handleFiltersChange}
            onFilterInvalid={(message) => setFilterError({ code: "CLIENT_VALIDATION", message })}
            onApplyRecurring={handleApplyRecurring}
          />
        </div>
        <div id="panel-stats" hidden={tab !== "stats"}>
          <CategorySpending spending={categorySpending} selected={selected} onRetry={reloadCategorySpending} onSelect={handleSpendingSelect} />
        </div>
        <div id="panel-settings" hidden={!isSettings}>
          <CategoryManager
            categories={categories}
            budgets={budgets}
            busy={categoryBusy}
            error={categoryError}
            renamingId={renamingCategoryId}
            budgetEditingId={budgetEditingId}
            resetKey={categoryResetKey}
            onAdd={handleAddCategory}
            onStartRename={handleStartRenameCategory}
            onRename={handleRenameCategory}
            onCancelRename={handleCancelCategoryEdit}
            onDelete={handleDeleteCategory}
            onStartBudget={handleStartBudget}
            onSaveBudget={handleSaveBudget}
            onDeleteBudget={handleDeleteBudget}
            onCancelBudget={handleCancelCategoryEdit}
            onRetry={reloadCategories}
          />
          <RecurringManager
            recurring={recurring}
            categories={categories}
            editing={recurringEditing}
            formOpen={recurringFormOpen}
            busy={recurringBusy}
            error={recurringError}
            resetKey={recurringResetKey}
            onStartAdd={() => openRecurringForm(null)}
            onSubmit={handleSubmitRecurring}
            onCancelEdit={handleCancelRecurring}
            onEdit={openRecurringForm}
            onDelete={handleDeleteRecurring}
            onRetry={reloadRecurring}
          />
          <DataManager
            busy={dataBusy}
            onBackup={() => handleDownload("backup", api.downloadBackup)}
            onExportCsv={() => handleDownload("csv", api.downloadCsv)}
            onRestoreFile={handleRestoreFile}
          />
        </div>
      </main>
      <button type="button" id="add-button" className="button-primary add-button" hidden={isSettings} onClick={openNewForm}>
        + 추가
      </button>
      <TransactionDialog
        open={form.open}
        resetKey={form.resetKey}
        editing={form.editing}
        defaults={form.defaults}
        error={form.error}
        notice={form.notice}
        categories={categories}
        submitting={submitting}
        toastSlotRef={setFormToastSlot}
        onSubmit={handleSubmit}
        onCancel={closeForm}
        onDelete={handleDelete}
        onRetryCategories={reloadCategories}
        onCloseRequest={handleFormCloseRequest}
        // Esc로 닫은 경우에도 폼 상태를 정리한다.
        onClosed={() => {
          if (form.open) closeForm();
        }}
      />
      <ConfirmDialog request={confirmRequest} onFinish={finishConfirm} toastSlotRef={setConfirmToastSlot} />
      <Toast toast={toast} host={toastHost} onHide={hideToast} />
    </>
  );
}
