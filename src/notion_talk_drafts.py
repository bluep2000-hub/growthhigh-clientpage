"""커뮤니케이션보드에 고객 비공개 회의록 초안을 멱등 생성한다."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import requests

from summarize_transcript import MeetingSummary
from talk_source import (
    CHANNEL_PROP,
    COMMUNICATION_DB_ID,
    COMPANY_PROP,
    DATE_PROP,
    MAJOR_PROP,
    PUBLIC_PROP,
    TITLE_PROP,
)


NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
SOURCE_URL_PROP = "URL"
DRIVE_ROOT_URL = (
    "https://drive.google.com/drive/folders/"
    "1Xh_QjqM8Jletd1NG6fep7khsDN_Vc-p_"
)
MAX_RETRIES = 3


class NotionDraftError(RuntimeError):
    """Notion 초안을 안전하게 만들거나 확인할 수 없다."""


@dataclass(frozen=True)
class NotionDraft:
    page_id: str
    url: str
    public: bool
    created: bool


def source_marker_url(job_id: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", job_id):
        raise NotionDraftError("녹음 식별자 형식이 올바르지 않다")
    return f"{DRIVE_ROOT_URL}?recording_sha256={job_id}"


def _plain(prop: dict) -> str:
    runs = prop.get("title") or prop.get("rich_text") or []
    return "".join(run.get("plain_text", "") for run in runs).strip()


def _multi(prop: dict) -> list[str]:
    return [item.get("name", "") for item in prop.get("multi_select") or []]


def rich_text(markdown: str) -> list[dict]:
    """회의록에서 사용하는 굵게 표시만 Notion rich text로 옮긴다."""
    out: list[dict] = []
    cursor = 0
    for match in re.finditer(r"\*\*(.+?)\*\*", markdown):
        if match.start() > cursor:
            out.extend(_text_chunks(markdown[cursor:match.start()], bold=False))
        out.extend(_text_chunks(match.group(1), bold=True))
        cursor = match.end()
    if cursor < len(markdown):
        out.extend(_text_chunks(markdown[cursor:], bold=False))
    return out or _text_chunks(" ", bold=False)


def _text_chunks(value: str, *, bold: bool) -> list[dict]:
    return [{
        "type": "text",
        "text": {"content": value[i:i + 2000]},
        "annotations": {"bold": bold},
    } for i in range(0, len(value), 2000) if value[i:i + 2000]]


def _block(kind: str, text: str) -> dict:
    return {
        "object": "block",
        "type": kind,
        kind: {"rich_text": rich_text(text)},
    }


def _table(lines: list[str]) -> dict:
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        rows.append({
            "object": "block",
            "type": "table_row",
            "table_row": {"cells": [rich_text(cell) for cell in cells]},
        })
    width = len(rows[0]["table_row"]["cells"])
    if not width or any(len(row["table_row"]["cells"]) != width for row in rows):
        raise NotionDraftError("회의록 표의 열 수가 맞지 않는다")
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": width,
            "has_column_header": True,
            "has_row_header": False,
            "children": rows,
        },
    }


def markdown_blocks(markdown: str) -> list[dict]:
    """검증된 회의록 Markdown을 Notion 블록으로 바꾼다."""
    lines = markdown.replace("\r\n", "\n").splitlines()
    blocks: list[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped == "---":
            blocks.append({"object": "block", "type": "divider", "divider": {}})
            i += 1
            continue
        heading = re.match(r"^##\s+(.+)$", stripped)
        if heading:
            blocks.append(_block("heading_2", heading.group(1)))
            i += 1
            continue
        if stripped.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            if len(table_lines) < 2:
                raise NotionDraftError("회의록 표에 머리 행 또는 구분 행이 없다")
            content_lines = [table_lines[0]] + table_lines[2:]
            blocks.append(_table(content_lines))
            continue
        bullet = re.match(r"^(\s*)-\s+(.+)$", line)
        if bullet:
            # Notion 중첩 목록은 부모 블록 children으로 연결한다.
            indent = len(bullet.group(1).replace("\t", "    ")) // 4
            item = _block("bulleted_list_item", bullet.group(2))
            if indent and blocks and blocks[-1].get("type") == "bulleted_list_item":
                blocks[-1]["bulleted_list_item"].setdefault("children", []).append(item)
            else:
                blocks.append(item)
            i += 1
            continue
        blocks.append(_block("paragraph", stripped))
        i += 1
    if not blocks:
        raise NotionDraftError("회의록 본문 블록이 비어 있다")
    if len(blocks) > 100:
        raise NotionDraftError("회의록이 100개 블록을 넘어 PM 확인이 필요하다")
    return blocks


def notion_channel(channel: str) -> str:
    if channel == "통화":
        return "유선"
    raise NotionDraftError(f"자동으로 확정할 수 없는 소통형태다: {channel}")


def draft_properties(job: dict, summary: MeetingSummary) -> dict:
    company = str(job.get("company_name") or "").strip()
    occurred = str(job.get("occurred_at") or "").strip()
    if not company or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", occurred):
        raise NotionDraftError("고객사 또는 통화 일자를 확정할 수 없다")
    return {
        TITLE_PROP: {"title": rich_text(summary.title)},
        COMPANY_PROP: {"multi_select": [{"name": company}]},
        DATE_PROP: {"date": {"start": occurred}},
        CHANNEL_PROP: {"multi_select": [{"name": notion_channel(str(job.get("channel") or ""))}]},
        SOURCE_URL_PROP: {"url": source_marker_url(str(job.get("id") or ""))},
        PUBLIC_PROP: {"checkbox": False},
        MAJOR_PROP: {"checkbox": False},
    }


class NotionDraftClient:
    def __init__(self, token: str, session: requests.Session | None = None):
        if not token.strip():
            raise NotionDraftError("NOTION_TOKEN이 없다")
        self.session = session or requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token.strip()}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        })

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self.session.request(
                    method,
                    f"{NOTION_API}{path}",
                    json=body,
                    timeout=60,
                )
            except requests.RequestException as exc:
                if attempt >= MAX_RETRIES:
                    raise NotionDraftError("Notion 연결에 실패했다") from exc
                time.sleep(2 ** attempt)
                continue
            if 200 <= response.status_code < 300:
                return response.json()
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < MAX_RETRIES:
                    wait = float(response.headers.get("Retry-After", 0) or 0)
                    time.sleep(wait or 2 ** attempt)
                    continue
            message = (response.json().get("message")
                       if response.headers.get("content-type", "").startswith("application/json")
                       else "")
            raise NotionDraftError(
                f"Notion 요청 실패({response.status_code}): {str(message)[:160]}"
            )
        raise NotionDraftError("Notion 요청에 실패했다")

    def _find(self, marker: str) -> list[dict]:
        result = self._request("POST", f"/databases/{COMMUNICATION_DB_ID}/query", {
            "page_size": 10,
            "filter": {"property": SOURCE_URL_PROP, "url": {"equals": marker}},
        })
        return list(result.get("results") or [])

    @staticmethod
    def _validate_existing(page: dict, company: str) -> None:
        props = page.get("properties") or {}
        if company not in _multi(props.get(COMPANY_PROP) or {}):
            raise NotionDraftError("같은 녹음 식별자가 다른 고객사 기록에 있다")

    def create_or_get(self, job: dict, summary: MeetingSummary) -> NotionDraft:
        marker = source_marker_url(str(job.get("id") or ""))
        existing = self._find(marker)
        if len(existing) > 1:
            raise NotionDraftError("같은 녹음의 Notion 기록이 둘 이상이다")
        if existing:
            page = existing[0]
            self._validate_existing(page, str(job.get("company_name") or ""))
            props = page.get("properties") or {}
            return NotionDraft(
                page_id=str(page.get("id") or ""),
                url=str(page.get("url") or ""),
                public=(props.get(PUBLIC_PROP) or {}).get("checkbox") is True,
                created=False,
            )

        page = self._request("POST", "/pages", {
            "parent": {"database_id": COMMUNICATION_DB_ID},
            "properties": draft_properties(job, summary),
            "children": markdown_blocks(summary.minutes_markdown),
        })
        return NotionDraft(
            page_id=str(page.get("id") or ""),
            url=str(page.get("url") or ""),
            public=False,
            created=True,
        )

    def is_public(self, job: dict) -> bool:
        page_id = str(job.get("notion_page_id") or "").strip()
        if not page_id:
            raise NotionDraftError("Notion 초안 주소가 처리 장부에 없다")
        page = self._request("GET", f"/pages/{page_id}")
        company = str(job.get("company_name") or "")
        self._validate_existing(page, company)
        props = page.get("properties") or {}
        expected_marker = source_marker_url(str(job.get("id") or ""))
        if (props.get(SOURCE_URL_PROP) or {}).get("url") != expected_marker:
            raise NotionDraftError("Notion 초안의 녹음 식별자가 바뀌었다")
        return (props.get(PUBLIC_PROP) or {}).get("checkbox") is True
