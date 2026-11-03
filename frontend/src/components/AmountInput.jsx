import { formatAmountText } from "../lib/format.js";

/**
 * 입력하는 동안 콤마를 보여 주는 금액 입력칸. 커서는 오른쪽 숫자 개수를 기준으로 유지한다.
 * React가 값을 다시 쓰면 커서가 끝으로 가므로, 입력칸에 먼저 써 두어 값이 같게 한다.
 */
export default function AmountInput({ value, onChange, inputRef, ...rest }) {
  const handleInput = (event) => {
    const input = event.target;
    const digitsAfterCaret = input.value.slice(input.selectionStart).replace(/,/g, "").length;
    input.value = formatAmountText(input.value);
    let caret = input.value.length;
    for (let seen = 0; caret > 0 && seen < digitsAfterCaret; caret -= 1) {
      if (input.value[caret - 1] !== ",") seen += 1;
    }
    input.setSelectionRange(caret, caret);
    onChange(input.value);
  };

  return <input type="text" inputMode="numeric" autoComplete="off" ref={inputRef} value={value} onChange={handleInput} {...rest} />;
}
