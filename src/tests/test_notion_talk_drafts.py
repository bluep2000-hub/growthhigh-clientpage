import sys
import unittest
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch


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
import client_mapping


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
        "source_name": "260912_위프코리아_통화_1430.m4a",
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
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folders_file = Path(temporary.name) / 'folders.json'
        self.folders_file.write_text(json.dumps({
            '위프코리아': '1Xh_QjqM8Jletd1NG6fep7khsDN_Vc-p_',
            '보울게임즈': 'bowlgames_folder_123',
        }), encoding='utf-8')
        environment = patch.dict(os.environ, RECORDING_DRIVE_FOLDERS_FILE=str(self.folders_file))
        environment.start()
        self.addCleanup(environment.stop)

    def test_recording_is_public_by_default_and_not_major(self):
        props = draft_properties(job(), MeetingSummary("서류 진행 협의", MINUTES))

        self.assertIs(props[PUBLIC_PROP]["checkbox"], True)
        self.assertIs(props[MAJOR_PROP]["checkbox"], False)
        self.assertEqual(
            props[COMPANY_PROP]["multi_select"],
            [{"name": "위프코리아"}],
        )
        self.assertIn("recording_sha256=", props["URL"]["url"])

    def test_labelled_meeting_uses_meeting_channel(self):
        props = draft_properties(
            {**job(), "channel": "미팅", "source_name": "260912_위프코리아_미팅_1430.m4a"},
            MeetingSummary("킥오프 미팅", MINUTES),
        )

        self.assertEqual(props["소통형태"]["multi_select"], [{"name": "미팅"}])

    def test_invalid_or_mismatched_label_never_calls_notion(self):
        for change in ({'source_name': '통화.m4a'}, {'source_name': '260912_내부_오전미팅.m4a'}, {'company_slug': 'other'}, {'channel': '미팅'}, {'occurred_at': '2026-09-13'}):
            client = FakeClient()
            with self.assertRaises(ValueError):
                client.create_or_get({**job(), **change}, MeetingSummary('제목', MINUTES))
            self.assertEqual(client.calls, [])

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
        self.assertIs(create_body["properties"][PUBLIC_PROP]["checkbox"], True)

    def test_existing_marker_prevents_duplicate_page(self):
        existing = {
            "id": "existing-page",
            "url": "https://notion.so/existing-page",
            "properties": {
                "일자": {"date": {"start": "2026-09-12"}},
                "소통형태": {"multi_select": [{"name": "유선"}]},
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
            source_marker_url("not-a-hash", '위프코리아')

    def test_public_approval_rechecks_customer_and_source_marker(self):
        item = job()
        page = {
            "id": "draft-page",
            "properties": {
                COMPANY_PROP: {"multi_select": [{"name": "위프코리아"}]},
                PUBLIC_PROP: {"checkbox": True},
                "URL": {"url": source_marker_url(item["id"], item['company_name'])},
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

    def test_customer_source_link_and_legacy_recovery(self):
        item = {**job(), 'source_name': '260912_보울게임즈_통화.m4a',
                'company_name': '보울게임즈', 'company_slug': 'bowlgames'}
        expected = source_marker_url(item['id'], '보울게임즈')
        self.assertIn('/bowlgames_folder_123?', expected)
        self.assertNotIn('1Xh_QjqM', expected)
        props = draft_properties(item, MeetingSummary('제목', MINUTES))
        self.assertEqual(props['URL']['url'], expected)
        props['URL']['url'] = source_marker_url(item['id'], '위프코리아')
        client = FakeClient([{'id': 'legacy-page', 'url': 'https://notion.so/legacy',
                              'properties': props}])
        result = client.create_or_get(item, MeetingSummary('제목', MINUTES))
        self.assertFalse(result.created)
        self.assertEqual([call[0] for call in client.calls], ['POST', 'PATCH'])
        self.assertEqual(client.calls[-1][2], {'properties': {'URL': {'url': expected}}})
        self.assertEqual(len(client.calls[0][2]['filter']['or']), 2)

    def test_missing_ambiguous_and_invalid_drive_mapping_stops_before_notion(self):
        for folders in ({}, {'위프코리아': 'https://bad.example'},
                        {'위프코리아': 'same_folder_123', '보울게임즈': 'same_folder_123'}):
            self.folders_file.write_text(json.dumps(folders), encoding='utf-8')
            client = FakeClient()
            with self.assertRaises(ValueError):
                client.create_or_get(job(), MeetingSummary('제목', MINUTES))
            self.assertEqual(client.calls, [])


if __name__ == "__main__":
    unittest.main()
