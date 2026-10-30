"""기본 분류 목록. 서버 시작 시 categories 테이블에 넣으며, 이름 수정·삭제할 수 없다."""

DEFAULT_CATEGORIES = {
    "expense": ("식비", "교통", "주거", "쇼핑", "의료", "문화·여가", "기타"),
    "income": ("월급", "용돈", "기타"),
}

TYPE_LABELS = {"income": "수입", "expense": "지출"}

MAX_CATEGORY_NAME_LENGTH = 20
