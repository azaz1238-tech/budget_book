import { useEffect, useRef } from "react";

/** 앱 안 확인 창. Esc는 취소다. request와 onFinish는 useConfirm에서 받는다. */
export default function ConfirmDialog({ request, onFinish, toastSlotRef }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      id="confirm-dialog"
      ref={dialogRef}
      className="confirm-dialog"
      aria-label="확인"
      // close는 비동기로 오므로, 그사이 다음 확인 창이 열렸으면 그 창을 취소하지 않는다.
      onClose={() => {
        if (!dialogRef.current.open) onFinish(false);
      }}
    >
      {request && (
        <>
          <p className="confirm-message">{request.message}</p>
          <div className="form-actions confirm-actions">
            <button type="button" className="button-secondary confirm-cancel" onClick={() => onFinish(false)}>
              취소
            </button>
            <button type="button" className={`${request.danger ? "button-danger" : "button-primary"} confirm-ok`} onClick={() => onFinish(true)}>
              {request.confirmText}
            </button>
          </div>
        </>
      )}
      <div ref={toastSlotRef} />
    </dialog>
  );
}
