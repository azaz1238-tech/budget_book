"""요청 본문 모델 (API_SPEC 2.2절, 3.7 ~ 3.8절)."""

import re
from datetime import date as Date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StrictInt, StrictStr, ValidationInfo, field_validator

from app.categories import MAX_CATEGORY_NAME_LENGTH, TYPE_LABELS
from app.db import category_exists, find_category_by_id

# 브라우저 JavaScript가 정확히 다룰 수 있는 가장 큰 정수 (Number.MAX_SAFE_INTEGER)
MAX_AMOUNT = 9007199254740991

DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")


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
        if not category_exists(type_, value):
            raise ValueError(f"{TYPE_LABELS[type_]}에는 '{value}' 분류를 사용할 수 없습니다.")
        return value

    @field_validator("memo")
    @classmethod
    def normalize_memo(cls, value):
        return normalize_memo(value)


def normalize_memo(value):
    """앞뒤 공백을 제거하고, 비면 None으로 저장한다."""
    if value is None:
        return None
    value = value.strip()
    return value or None


def normalize_category_name(value):
    value = value.strip()
    if not value:
        raise ValueError("분류 이름을 입력해 주세요.")
    if len(value) > MAX_CATEGORY_NAME_LENGTH:
        raise ValueError(f"분류 이름은 {MAX_CATEGORY_NAME_LENGTH}자 이하여야 합니다.")
    return value


CategoryName = Annotated[StrictStr, AfterValidator(normalize_category_name)]


class CategoryInput(BaseModel):
    """분류 추가 본문. id, is_default 등은 무시한다."""

    type: Literal["income", "expense"]
    name: CategoryName


class CategoryRename(BaseModel):
    """분류 이름 수정 본문. 유형은 바꿀 수 없으므로 type은 무시한다."""

    name: CategoryName


Amount = Annotated[StrictInt, Field(ge=1, le=MAX_AMOUNT)]


class BudgetInput(BaseModel):
    """v0.10 예산 본문."""

    amount: Amount


class RecurringInput(BaseModel):
    """v0.11 고정 거래 추가·수정 본문. 검사 순서: day → type → amount → category_id → memo"""

    day: Annotated[StrictInt, Field(ge=1, le=31)]
    type: Literal["income", "expense"]
    amount: Amount
    category_id: StrictInt
    memo: StrictStr | None = None

    @field_validator("category_id")
    @classmethod
    def check_category(cls, value, info: ValidationInfo):
        row = find_category_by_id(value)
        if row is None:
            raise ValueError("분류를 찾을 수 없습니다.")
        type_ = info.data.get("type")
        if type_ is not None and row["type"] != type_:
            raise ValueError(f"{TYPE_LABELS[type_]}에는 '{row['name']}' 분류를 사용할 수 없습니다.")
        return value

    @field_validator("memo")
    @classmethod
    def normalize_memo(cls, value):
        return normalize_memo(value)


class RecurringApplyInput(BaseModel):
    """v0.11 고정 거래 불러오기 본문."""

    year: Annotated[StrictInt, Field(ge=1, le=9999)]
    month: Annotated[StrictInt, Field(ge=1, le=12)]
