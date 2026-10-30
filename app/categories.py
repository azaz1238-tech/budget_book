"""고정 분류 목록. MVP에서는 추가·수정·삭제하지 않는다."""

CATEGORIES = {
    "expense": ("식비", "교통", "주거", "쇼핑", "의료", "문화·여가", "기타"),
    "income": ("월급", "용돈", "기타"),
}


def categories_as_lists():
    return {type_: list(names) for type_, names in CATEGORIES.items()}
