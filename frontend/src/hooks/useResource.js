import { useCallback, useEffect, useState } from "react";

/**
 * 서버 데이터를 불러와 { status: "loading" | "success" | "error" } 상태로 돌려준다.
 * deps가 바뀌거나 reload를 부르면 다시 불러온다. 이전 요청의 결과는 버리므로
 * 늦게 도착한 응답이 최신 상태를 덮어쓰지 않는다.
 * fetcher가 null이면 불러오지 않고 상태를 null로 둔다.
 */
export function useResource(fetcher, deps) {
  const [state, setState] = useState(fetcher ? { status: "loading" } : null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!fetcher) {
      setState(null);
      return undefined;
    }
    let active = true;
    setState({ status: "loading" });
    fetcher().then(
      (data) => {
        if (active) setState({ status: "success", data });
      },
      (error) => {
        if (active) setState({ status: "error", error });
      },
    );
    return () => {
      active = false;
    };
    // fetcher는 렌더링마다 새로 만들어지므로 deps로 다시 불러올 시점을 정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return [state, reload];
}
