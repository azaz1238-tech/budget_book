import { useEffect, useState } from "react";

const COMPACT_AT = 80;
const EXPAND_AT = 8;
const MIN_SCROLL_ROOM = 200;

/** 스크롤하면 요약을 한 줄로 줄인다. 줄이는 위치와 되돌리는 위치를 달리해 깜빡이지 않게 한다 (TRD 15.5절). */
export function useCompactHeader() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const update = () => {
      const y = window.scrollY;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      setCompact((current) => (current ? y >= EXPAND_AT : y > COMPACT_AT && room > MIN_SCROLL_ROOM));
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return compact;
}
