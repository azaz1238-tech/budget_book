"""요청 본문 모델 (API_SPEC 2.2절)."""

import re
from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, Field, StrictInt, StrictStr, ValidationInfo, field_validator

from app.categories import CATEGORIES

# 브라우저 JavaScript가 정확히 다룰 수 있는 가장 큰 정수 (Number.MAX_SAFE_INTEGER)
MAX_AMOUNT = 9007199254740991

DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")
TYPE_LABELS = {"income": "수입", "expense": "지출"}


class TransactionInput(BaseModel):
    """등록·수정 공통 본문. 정의되지 않은 필드(id, created_at 등)는 무시한다."""

    date: Date
    type: Literal["income", "expense"]
    amount: StrictInt = Field(ge=1, le=MAX_AMOUNT)
    category: StrictStr
    memo: StrictStr | None = None

    @field_validator("date", mode="before")
    @classmethod
    def check_date_format(cls, value):
        # Pydantic 기본 변환은 숫자(타임스탬프)나 "20261030"도 날짜로 받아들이므로 직접 검사한다.
        if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
            raise ValueError("거래일이 올바른 날짜가 아닙니다.")
        try:
            return Date.fromisoformat(value)
        except ValueError:
            raise ValueError("거래일이 올바른 날짜가 아닙니다.") from None

    @field_validator("category")
    @classmethod
    def check_category(cls, value, info: ValidationInfo):
        type_ = info.data.get("type")
        if type_ is None:
            # 유형이 잘못된 경우 유형 에러를 먼저 돌려주므로 여기서는 검사하지 않는다.
            return value
        if value not in CATEGORIES[type_]:
            raise ValueError(f"{TYPE_LABELS[type_]}에는 '{value}' 분류를 사용할 수 없습니다.")
        return value

    @field_validator("memo")
    @classmethod
    def normalize_memo(cls, value):
        if value is None:
            return None
        value = value.strip()
        return value or None
