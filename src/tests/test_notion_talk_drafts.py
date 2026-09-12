import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from notion_talk_drafts import (  # noqa: E402
    NotionDraftClient,
    NotionDraftError,
    draft_properties,
    markdown_blocks,
    source_marker_url,
)
from summarize_transcript import MeetingSummary  # noqa: E402
from talk_source import COMPANY_PROP, MAJOR_PROP, PUBLIC_PROP  # noqa: E402


MINUTES = """## 1. 서류 진행

- **신청서 초안**을 검토함

## 2. Action Items

| 항목 | 담당 | 기한 |
| --- | --- | --- |
| 신청서 전달 | 클라이언트 | 미정 |
"""


def job() -> dict:
    return {
        "id": "c" * 64,
        "company_name": "위프코리아",
        "company_slug": "whiffkorea",
        "channel": "통화",
        "occurred_at": "2026-09-12",
    }


class FakeClient(NotionDraftClient):
    def __init__(self, query_results=None, page=None):
        self.query_results = query_results or []
        self.page = page
        self.calls = []

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        self.calls.append((method, path, body))
        if path.endswith("/query"):
            return {"results": self.query_results}
        if method == "GET":
            return self.page
        return {"id": "new-page", "url": "https://notion.so/new-page"}


class NotionTalkDraftTests(unittest.TestCase):
    def test_draft_is_private_and_not_major(self):
        props = draft_properties(job(), MeetingSummary("서류 진행 협의", MINUTES))

        self.assertIs(props[PUBLIC_PROP]["checkbox"], False)
        self.assertIs(props[MAJOR_PROP]["checkbox"], False)
        self.assertEqual(
            props[COMPANY_PROP]["multi_select"],
            [{"name": "위프코리아"}],
        )
        self.assertIn("recording_sha256=", props["URL"]["url"])

    def test_markdown_table_does_not_keep_separator_as_data(self):
        blocks = markdown_blocks(MINUTES)
        table = next(block["table"] for block in blocks if block["type"] == "table")

        self.assertEqual(table["table_width"], 3)
        self.assertEqual(len(table["children"]), 2)

    def test_create_queries_marker_before_writing(self):
        client = FakeClient()

        result = client.create_or_get(job(), MeetingSummary("서류 진행 협의", MINUTES))

        self.assertTrue(result.created)
        self.assertEqual(client.calls[0][1].split("/")[-1], "query")
        create_body = client.calls[1][2]
        self.assertIs(create_body["properties"][PUBLIC_PROP]["checkbox"], False)

    def test_existing_marker_prevents_duplicate_page(self):
        existing = {
            "id": "existing-page",
            "url": "https://notion.so/existing-page",
            "properties": {
                COMPANY_PROP: {"multi_select": [{"name": "위프코리아"}]},
                PUBLIC_PROP: {"checkbox": False},
            },
        }
        client = FakeClient([existing])

        result = client.create_or_get(job(), MeetingSummary("서류 진행 협의", MINUTES))

        self.assertFalse(result.created)
        self.assertEqual(result.page_id, "existing-page")
        self.assertEqual(len(client.calls), 1)

    def test_existing_marker_for_other_customer_stops(self):
        existing = {
            "id": "wrong-page",
            "properties": {
                COMPANY_PROP: {"multi_select": [{"name": "다른기업"}]},
                PUBLIC_PROP: {"checkbox": False},
            },
        }
        client = FakeClient([existing])

        with self.assertRaisesRegex(NotionDraftError, "다른 고객사"):
            client.create_or_get(job(), MeetingSummary("서류 진행 협의", MINUTES))

    def test_rejects_non_hash_job_id(self):
        with self.assertRaisesRegex(NotionDraftError, "식별자"):
            source_marker_url("not-a-hash")

    def test_public_approval_rechecks_customer_and_source_marker(self):
        item = job()
        page = {
            "id": "draft-page",
            "properties": {
                COMPANY_PROP: {"multi_select": [{"name": "위프코리아"}]},
                PUBLIC_PROP: {"checkbox": True},
                "URL": {"url": source_marker_url(item["id"])},
            },
        }
        client = FakeClient(page=page)

        self.assertTrue(client.is_public({**item, "notion_page_id": "draft-page"}))

    def test_public_approval_stops_if_source_marker_changed(self):
        item = job()
        page = {
            "id": "draft-page",
            "properties": {
                COMPANY_PROP: {"multi_select": [{"name": "위프코리아"}]},
                PUBLIC_PROP: {"checkbox": True},
                "URL": {"url": "https://drive.google.com/wrong"},
            },
        }
        client = FakeClient(page=page)

        with self.assertRaisesRegex(NotionDraftError, "식별자"):
            client.is_public({**item, "notion_page_id": "draft-page"})


if __name__ == "__main__":
    unittest.main()
