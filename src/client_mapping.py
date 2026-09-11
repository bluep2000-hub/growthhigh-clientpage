"""자동화에서 쓰는 고객사 폴더명과 클라이언트 페이지 슬러그의 연결."""

from __future__ import annotations


COMPANY_SLUGS = {
    "위프코리아": "whiffkorea",
}


class UnknownCompanyError(ValueError):
    """등록되지 않은 고객사 이름이라 안전하게 페이지를 고를 수 없다."""


def client_slug_for(company: str) -> str:
    """고객사 폴더명을 정확히 일치하는 클라이언트 슬러그로 바꾼다."""
    normalized = company.strip()
    try:
        return COMPANY_SLUGS[normalized]
    except KeyError as exc:
        raise UnknownCompanyError(
            f"등록되지 않은 고객사 폴더다: {normalized or '(빈 이름)'}"
        ) from exc
