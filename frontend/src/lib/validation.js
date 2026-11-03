// 클라이언트 검사. 문구는 서버 message와 같게 맞춘다.

export const MAX_KEYWORD_LENGTH = 50;
const MAX_CATEGORY_NAME_LENGTH = 20;

export function validateAmount(amount) {
  if (amount === null) return "금액을 입력해 주세요.";
  if (!Number.isSafeInteger(amount) || amount < 1) return "금액은 1 이상의 정수여야 합니다.";
  return null;
}

export function validateTransactionInput(input) {
  if (!input.date) return "거래일을 입력해 주세요.";
  const amountError = validateAmount(input.amount);
  if (amountError) return amountError;
  if (!input.category) return "분류를 선택해 주세요.";
  return null;
}

/** 길이는 유니코드 문자 수로 센다. */
export function validateCategoryName(name) {
  const trimmed = name.trim();
  if (!trimmed) return "분류 이름을 입력해 주세요.";
  if ([...trimmed].length > MAX_CATEGORY_NAME_LENGTH) return `분류 이름은 ${MAX_CATEGORY_NAME_LENGTH}자 이하여야 합니다.`;
  return null;
}

export function validateRecurringInput(input) {
  if (input.day === null) return "날을 입력해 주세요.";
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) return "날은 1부터 31 사이여야 합니다.";
  const amountError = validateAmount(input.amount);
  if (amountError) return amountError;
  if (input.category_id === null) return "분류를 선택해 주세요.";
  return null;
}
