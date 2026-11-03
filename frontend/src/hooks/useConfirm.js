import { useCallback, useRef, useState } from "react";

/**
 * 앱 안 확인 창. confirm({ message, confirmText, danger })는 확인하면 true로 끝나는 Promise를 돌려준다.
 * request와 finish는 ConfirmDialog에 넘긴다.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback(
    ({ message, confirmText = "확인", danger = false }) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setRequest({ message, confirmText, danger });
      }),
    [],
  );

  const finish = useCallback((result) => {
    const resolve = resolver.current;
    if (!resolve) return;
    resolver.current = null;
    setRequest(null);
    resolve(result);
  }, []);

  return { confirm, request, finish };
}
