"""전사본을 검증 가능한 회의록 초안으로 바꾼다."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from google import genai
from google.genai import types


DEFAULT_MODEL = "gemini-3.6-flash"
# 짧은 확인 전화도 소통 기록이 될 수 있다. 인사말 몇 마디 수준의 전사만 막고,
# 내용의 품질은 아래 회의록 형식 검증과 공개 후 PM 수정에서 다시 확인한다.
MIN_TRANSCRIPT_CHARS = 100

# 고객 공개 전에는 표현을 임의로 지우지 않고 검토 대상으로 멈춘다.
PUBLIC_REVIEW_TERMS = re.compile(
    r"장애|병신|미친|바보|멍청|또라이|벙어리|장님|절름발이|불구|정박아|씨발|개새끼|리젝|표현 검토 필요",
    re.IGNORECASE,
)

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "minutes_markdown": {"type": "string"},
    },
    "required": ["title", "minutes_markdown"],
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
- title은 가장 큰 안건을 담은 짧은 제목입니다. 띄어쓰기를 포함해 반드시 25자
  이하로 쓰고, JSON을 반환하기 전에 글자 수를 확인하세요.
- 전사에 나온 순서대로 `## 1. 안건명` 형식의 섹션을 만듭니다.
- 한 줄 요약으로 끝내지 마세요. 안건마다 전사에서 확인되는 배경과 현재 상황, 실제 논의 내용,
  제시된 선택지와 조건, 결정 및 그 근거, 남은 확인 사항을 구체적으로 적습니다.
- 같은 안건 안에서도 서로 다른 발언·조건·후속 조치는 별도 불릿으로 구분합니다.
  짧은 통화는 실제 내용만큼만 적고, 긴 회의는 중요한 논의를 생략해 억지로 줄이지 않습니다.
- 고객이 바로 확인할 수 있는 실무 메모로 씁니다. 각 불릿은 `쟁점: 확인된 사실·수치 / 판단·미결 상태`처럼
  핵심어로 시작하고, 한 불릿에는 한 쟁점만 담습니다. 길어지면 불릿을 나눕니다.
- 불릿을 보고서 문장처럼 `~다.`·`~습니다.`로 끝내지 않습니다. `검토 중`, `제안`, `미정`,
  `확인 필요`, `예정`처럼 상태가 보이는 간결한 한국어로 끝냅니다.
- 확정된 결정과 제안·목표·예시·미결 사항을 구분합니다. 전사에 없는 결론을 만들지 않습니다.
- 누가 무엇을 말하거나 요청했는지가 의미 있는 경우에는 주체를 밝힙니다.
  결론·핵심 조건만 굵게 표시하고, 들리지 않은 내용은 채우지 않습니다.
- 숫자·금액·날짜·지역명·기관명은 전사에 들린 값 그대로 씁니다.
- 전사에 없는 내용, 결론, 담당자, 기한을 추측하지 않습니다.
- 결론이 안 났으면 `추가 검토 필요`라고 적습니다.
- 인사말·잡담·중복 발언과 화자 표시는 뺍니다.
- 고객에게 불필요한 개인 평가, 욕설·비하·차별 표현, 외모·성별·건강·장애에 대한
  언급은 회의록에 옮기지 않습니다. 업무상 필요한 사실은 의미를 보존해 중립적인
  표현으로 적고, 원문의 부적절한 단어를 인용하지 않습니다.
- 자금 논의에 나온 가족관계·가족 재산 등 제3자의 사생활은 고객용 회의록에
  구체적으로 적지 않습니다. 자금 투입 가능성과 고객의 후속 검토 사항만 남깁니다.
- 비속어·은어·불필요한 영어 표현은 고객이 이해할 수 있는 업무 용어로 바꿉니다.
- 표현을 바꾸면 중요한 사실이 왜곡될 수 있으면 `표현 검토 필요`라고 적습니다.
  이 표시는 자동 공개를 중단하고 담당자 확인으로 넘기는 신호입니다.
- 화면 연결 중 말한 와이파이 비밀번호 등 인증정보는 회의록에 싣지 않습니다.
- 마지막 섹션 제목은 반드시 `## 후속 실행 항목`이며 아래 표의 두 줄을 정확히 사용합니다.
  `| 항목 | 담당 | 기한 |`
  `| --- | --- | --- |`
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
    if PUBLIC_REVIEW_TERMS.search(f"{title}\n{minutes}"):
        raise SummaryNeedsReview("고객 공개 전 표현 검토가 필요하다")

    headings = list(re.finditer(r"^##\s+(.+?)\s*$", minutes, re.MULTILINE))
    numbered_headings = [
        heading for heading in headings
        if re.match(r"^\d+\.\s+", heading.group(1))
    ]
    if not numbered_headings:
        raise SummaryNeedsReview("번호가 붙은 안건이 없다")
    final_heading = re.sub(r"^\d+\.\s+", "", headings[-1].group(1))
    if "action items" not in final_heading.lower() and final_heading != "후속 실행 항목":
        raise SummaryNeedsReview("마지막 섹션이 후속 실행 항목이 아니다")

    # 고객에게 곧바로 공개되는 기록이다. 장문 서술체가 다시 자동 게시되지 않게 한다.
    if any(re.search(r"(?:다|니다)\.(?:\s|$)", line)
           for line in minutes.splitlines() if line.lstrip().startswith("- ")):
        raise SummaryNeedsReview("회의록 불릿이 서술형 문체다. 실무 메모로 다시 작성 필요")

    lines = minutes.splitlines()
    header_index = next(
        (i for i, line in enumerate(lines)
         if _table_cells(line) == ["항목", "담당", "기한"]),
        None,
    )
    if header_index is None or header_index + 1 >= len(lines):
        raise SummaryNeedsReview("후속 실행 항목 표 머리 행이 없다")
    separator = _table_cells(lines[header_index + 1])
    if len(separator) != 3 or any(not re.fullmatch(r":?-{3,}:?", x) for x in separator):
        raise SummaryNeedsReview("후속 실행 항목 표 구분 행이 올바르지 않다")

    for line in lines[header_index + 2:]:
        if not line.strip():
            continue
        if line.startswith("## "):
            raise SummaryNeedsReview("후속 실행 항목 뒤에 다른 섹션이 있다")
        if not line.lstrip().startswith("|"):
            continue
        cells = _table_cells(line)
        if len(cells) != 3:
            raise SummaryNeedsReview("후속 실행 항목 표의 열 수가 맞지 않는다")
        if cells[1] not in {"그로스하이", "클라이언트"}:
            raise SummaryNeedsReview("후속 실행 항목 담당이 허용된 값이 아니다")
        if not cells[0] or not cells[2]:
            raise SummaryNeedsReview("후속 실행 항목 표의 항목 또는 기한이 비어 있다")

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
