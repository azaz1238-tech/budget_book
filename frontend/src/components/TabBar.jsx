const TABS = [
  ["list", "내역"],
  ["stats", "통계"],
  ["settings", "설정"],
];

export default function TabBar({ tab, onChange }) {
  return (
    <nav id="tab-bar" className="tab-bar" role="tablist" aria-label="화면 선택">
      {TABS.map(([value, text]) => (
        <button
          key={value}
          type="button"
          role="tab"
          className={`tab-button${tab === value ? " is-active" : ""}`}
          aria-selected={tab === value}
          onClick={() => onChange(value)}
        >
          {text}
        </button>
      ))}
    </nav>
  );
}
