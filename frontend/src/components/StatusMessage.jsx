export default function StatusMessage({ kind, message, onRetry, action }) {
  return (
    <div className={`status status-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button-secondary" onClick={onRetry}>
          다시 시도
        </button>
      )}
      {action && (
        <button type="button" className="button-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
