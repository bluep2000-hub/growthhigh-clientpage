"""전사본을 검증 가능한 회의록 초안으로 바꾼다."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from google import genai
from google.genai import types


DEFAULT_MODEL = "gemini-3.8-flash"
MIN_TRANSCRIPT_CHARS = 500

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "minutes_markdown": {"type": "string"},
    },
    "required": ["title", "minutes_markdown"],
    "additionalProperties": False,
}


class SummaryNeedsReview(ValueError):
    """자동 공개로 넘기면 안 되고 PM 확인이 필요한 요약 결과다."""


@dataclass(frozen=True)
class MeetingSummary:
    title: str
    minutes_markdown: str


def prompt_for(*, transcript: str, company: str, occurred_at: str,
               channel: str) -> str:
    return f"""아래 한국어 {channel} 전사본을 고객에게 공유할 회의록 초안으로 정리하세요.

고객사: {company}
일자: {occurred_at}

반드시 지킬 규칙:
- title은 가장 큰 안건을 담은 25자 이내의 짧은 제목입니다.
- 전사에 나온 순서대로 `## 1. 안건명` 형식의 섹션을 만듭니다.
- 각 사실은 불릿 한 줄로 쓰고, 결론·핵심 조건만 굵게 표시합니다.
- 숫자·금액·날짜·지역명·기관명은 전사에 들린 값 그대로 씁니다.
- 전사에 없는 내용, 결론, 담당자, 기한을 추측하지 않습니다.
- 결론이 안 났으면 `추가 검토 필요`라고 적습니다.
- 인사말·잡담·중복 발언과 화자 표시는 뺍니다.
- 마지막 섹션은 반드시 `Action Items`이며 아래 머리 행을 정확히 사용합니다.
  `| 항목 | 담당 | 기한 |`
- 확인된 할 일이 없으면 머리 행과 구분 행만 두고 임의의 할 일을 만들지 않습니다.
- 담당은 전사에서 확인될 때만 `그로스하이` 또는 `클라이언트`로 씁니다.
- 기한이 안 나왔으면 `미정`으로 씁니다.
- 결과는 지정된 JSON 형식만 반환합니다.

전사본:
---
{transcript.strip()}
---"""


def _table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def validate_summary(title: str, minutes_markdown: str) -> MeetingSummary:
    title = " ".join(title.split())
    minutes = minutes_markdown.replace("\r\n", "\n").strip()
    if not title:
        raise SummaryNeedsReview("회의록 제목이 비어 있다")
    if len(title) > 25:
        raise SummaryNeedsReview("회의록 제목이 25자를 넘는다")
    if not minutes:
        raise SummaryNeedsReview("회의록 본문이 비어 있다")

    headings = list(re.finditer(r"^##\s+\d+\.\s+(.+?)\s*$", minutes, re.MULTILINE))
    if not headings:
        raise SummaryNeedsReview("번호가 붙은 안건이 없다")
    if "action items" not in headings[-1].group(1).lower():
        raise SummaryNeedsReview("마지막 섹션이 Action Items가 아니다")

    lines = minutes.splitlines()
    header_index = next(
        (i for i, line in enumerate(lines)
         if _table_cells(line) == ["항목", "담당", "기한"]),
        None,
    )
    if header_index is None or header_index + 1 >= len(lines):
        raise SummaryNeedsReview("Action Items 표 머리 행이 없다")
    separator = _table_cells(lines[header_index + 1])
    if len(separator) != 3 or any(not re.fullmatch(r":?-{3,}:?", x) for x in separator):
        raise SummaryNeedsReview("Action Items 표 구분 행이 올바르지 않다")

    for line in lines[header_index + 2:]:
        if not line.strip():
            continue
        if line.startswith("## "):
            raise SummaryNeedsReview("Action Items 뒤에 다른 섹션이 있다")
        if not line.lstrip().startswith("|"):
            continue
        cells = _table_cells(line)
        if len(cells) != 3:
            raise SummaryNeedsReview("Action Items 표의 열 수가 맞지 않는다")
        if cells[1] not in {"그로스하이", "클라이언트"}:
            raise SummaryNeedsReview("Action Items 담당이 허용된 값이 아니다")
        if not cells[0] or not cells[2]:
            raise SummaryNeedsReview("Action Items 항목 또는 기한이 비어 있다")

    return MeetingSummary(title=title, minutes_markdown=minutes)


def summarize(client: genai.Client, *, model: str, transcript: str,
              company: str, occurred_at: str, channel: str) -> MeetingSummary:
    transcript = transcript.strip()
    if len(transcript) < MIN_TRANSCRIPT_CHARS:
        raise SummaryNeedsReview(
            f"전사본이 너무 짧다({len(transcript)}자). 원본 확인이 필요하다"
        )

    response = client.models.generate_content(
        model=model,
        contents=prompt_for(
            transcript=transcript,
            company=company,
            occurred_at=occurred_at,
            channel=channel,
        ),
        config=types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=SUMMARY_SCHEMA,
        ),
    )
    if (response.candidates
            and str(response.candidates[0].finish_reason).endswith("MAX_TOKENS")):
        raise SummaryNeedsReview("회의록이 출력 한도에서 잘렸다")
    try:
        payload = json.loads(response.text or "")
        title = payload["title"]
        minutes = payload["minutes_markdown"]
    except (TypeError, ValueError, KeyError) as exc:
        raise SummaryNeedsReview("회의록 응답 형식을 읽을 수 없다") from exc
    if not isinstance(title, str) or not isinstance(minutes, str):
        raise SummaryNeedsReview("회의록 제목 또는 본문 형식이 올바르지 않다")
    return validate_summary(title, minutes)
