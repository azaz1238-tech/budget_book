import { createPortal } from "react-dom";

/**
 * 화면 아래 알림. 모달 창이 열리면 바깥 요소를 누를 수 없으므로 host(열린 창 또는 body)에 그린다.
 * toast: { message, kind, action, sticky } 또는 null
 */
export default function Toast({ toast, host, onHide }) {
  return createPortal(
    <div id="toast-region" className="toast-region" aria-live="polite">
      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                onHide();
                toast.action.onClick();
              }}
            >
              {toast.action.label}
            </button>
          )}
          {/* 에러와 복원 결과는 읽을 시간이 필요하므로 닫기를 누를 때까지 남긴다. */}
          {toast.sticky && (
            <button type="button" className="toast-action" onClick={onHide}>
              닫기
            </button>
          )}
        </div>
      )}
    </div>,
    host,
  );
}
