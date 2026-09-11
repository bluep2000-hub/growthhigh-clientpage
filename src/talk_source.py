"""커뮤니케이션보드의 노션 스키마를 고객용 소통 한 건으로 바꾼다.

고객 페이지 빌더는 이 모듈의 작은 인터페이스만 알고, 노션 속성 이름과
공개·고객사 검증 규칙은 여기 한곳에 둔다. 값이 모호하면 공개하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass


COMMUNICATION_DB_ID = "13d815d7-12b9-8066-aed3-fcff75ae4492"

TITLE_PROP = "상세내용"
COMPANY_PROP = "기업명"
DATE_PROP = "일자"
CHANNEL_PROP = "소통형태"
MAJOR_PROP = "주요사항 확인"
PUBLIC_PROP = "고객 공개"

CHANNEL_NAMES = {
    "유선": "통화",
    "메일": "메일",
    "대면미팅": "미팅",
    "비대면미팅": "미팅",
    "카톡": "카톡",
    "문자": "문자",
}


@dataclass(frozen=True)
class PublicTalk:
    page_id: str
    date: str
    channel: str
    title: str
    major: bool


def _plain(prop: dict) -> str:
    runs = prop.get("title") or prop.get("rich_text") or []
    return "".join(r.get("plain_text", "") for r in runs).strip()


def _multi(prop: dict) -> list[str]:
    return [x.get("name", "") for x in prop.get("multi_select") or [] if x.get("name")]


def query_payload(company_name: str, page_size: int) -> dict:
    """한 기업의 공개 체크된 기록만 노션에서 받는 조회 조건."""
    name = company_name.strip()
    if not name:
        raise ValueError("기업명이 비어 있습니다")
    return {
        "page_size": page_size,
        "filter": {"and": [
            {"property": COMPANY_PROP, "multi_select": {"contains": name}},
            {"property": PUBLIC_PROP, "checkbox": {"equals": True}},
        ]},
        "sorts": [{"property": DATE_PROP, "direction": "descending"}],
    }


def parse_public_talk(page: dict, company_name: str) -> PublicTalk | None:
    """조회 결과를 다시 검증해 고객용 메타데이터로 바꾼다.

    노션의 서버 쪽 필터만 믿지 않고 기업명과 공개 체크를 다시 확인한다.
    소통형태가 정확히 하나가 아니거나 알 수 없는 값이면 공개하지 않는다.
    """
    props = page.get("properties") or {}
    name = company_name.strip()
    if not name or name not in _multi(props.get(COMPANY_PROP) or {}):
        return None
    if (props.get(PUBLIC_PROP) or {}).get("checkbox") is not True:
        return None

    raw_channels = _multi(props.get(CHANNEL_PROP) or {})
    if len(raw_channels) != 1 or raw_channels[0] not in CHANNEL_NAMES:
        return None
    channel = CHANNEL_NAMES[raw_channels[0]]
    date = ((props.get(DATE_PROP) or {}).get("date") or {}).get("start") or ""

    return PublicTalk(
        page_id=str(page.get("id") or ""),
        date=date[:10],
        channel=channel,
        title=_plain(props.get(TITLE_PROP) or {}),
        major=(props.get(MAJOR_PROP) or {}).get("checkbox") is True,
    )
