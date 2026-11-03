import { useEffect, useRef } from "react";

import { MAX_MONTH, MIN_MONTH, pad2, sameMonth, shiftMonth } from "../lib/format.js";

export function MonthSelector({ value, disabled, onChange }) {
  // <input type="month">는 연도를 4자리로 받는다. (예: 0001-01)
  const current = `${String(value.year).padStart(4, "0")}-${pad2(value.month)}`;
  const inputRef = useRef(null);

  // React의 onChange는 입력할 때마다 불리므로, 값을 확정했을 때 오는 change 이벤트를 직접 듣는다.
  useEffect(() => {
    const input = inputRef.current;
    const handleChange = () => {
      const match = /^(\d{4})-(\d{2})$/.exec(input.value);
      if (!match) {
        // 값을 지우거나 잘못 입력하면 이전 연·월을 유지한다.
        input.value = current;
        return;
      }
      onChange({ year: Number(match[1]), month: Number(match[2]) });
    };
    input.addEventListener("change", handleChange);
    return () => input.removeEventListener("change", handleChange);
  }, [current, onChange]);

  return <input key={current} ref={inputRef} type="month" defaultValue={current} disabled={disabled} aria-label="조회할 연·월" />;
}

export function MonthNavigator({ value, today, disabled, pickerOpen, onChange, onTogglePicker }) {
  const atMin = sameMonth(value, MIN_MONTH);
  const atMax = sameMonth(value, MAX_MONTH);
  return (
    <div id="month-navigator" className="month-navigator">
      <button
        type="button"
        className="button-secondary nav-button"
        aria-label="이전 달"
        disabled={disabled || atMin}
        onClick={() => onChange(shiftMonth(value, -1))}
      >
        ‹
      </button>
      <button type="button" className="month-label" aria-expanded={pickerOpen} title="연·월 입력" disabled={disabled} onClick={onTogglePicker}>
        {`${value.year}년 ${value.month}월`}
      </button>
      <button
        type="button"
        className="button-secondary nav-button"
        aria-label="다음 달"
        disabled={disabled || atMax}
        onClick={() => onChange(shiftMonth(value, 1))}
      >
        ›
      </button>
      {!sameMonth(value, today) && (
        <button type="button" className="button-secondary today-button" disabled={disabled} onClick={() => onChange(today)}>
          이번 달
        </button>
      )}
    </div>
  );
}
