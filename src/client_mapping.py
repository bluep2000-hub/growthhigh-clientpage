"""자동화에서 쓰는 고객사 폴더명과 클라이언트 페이지 슬러그의 연결."""

from __future__ import annotations

import json
from pathlib import Path


COMPANY_SLUGS = {
    "위프코리아": "whiffkorea",
    "보울게임즈": "bowlgames",
}
MAPPING_FILE = Path(__file__).with_name("client_mapping.json")


class UnknownCompanyError(ValueError):
    """등록되지 않은 고객사 이름이라 안전하게 페이지를 고를 수 없다."""


def client_slug_for(company: str) -> str:
    """고객사 폴더명을 정확히 일치하는 클라이언트 슬러그로 바꾼다."""
    normalized = company.strip()
    try:
        return (COMPANY_SLUGS | load_registered_clients())[normalized]
    except KeyError as exc:
        raise UnknownCompanyError(
            f"등록되지 않은 고객사 폴더다: {normalized or '(빈 이름)'}"
        ) from exc


def load_registered_clients() -> dict[str, str]:
    try:
        data = json.loads(MAPPING_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(data, dict) or any(not isinstance(k, str) or not isinstance(v, str)
                                         for k, v in data.items()):
        raise ValueError("고객사 녹음 폴더 연결 파일이 올바르지 않습니다")
    return data


def register_client(company: str, slug: str) -> None:
    current = load_registered_clients()
    known = COMPANY_SLUGS | current
    if company in known and known[company] != slug:
        raise ValueError("기존 고객사의 녹음 폴더 주소가 다릅니다")
    if any(name != company and value == slug for name, value in known.items()):
        raise ValueError("영문 주소가 다른 녹음 폴더에 이미 연결됐습니다")
    if known.get(company) == slug:
        return
    current[company] = slug
    temporary = MAPPING_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(MAPPING_FILE)
