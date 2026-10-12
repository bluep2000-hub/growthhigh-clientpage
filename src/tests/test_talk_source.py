import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from talk_source import parse_public_talk, query_payload  # noqa: E402
import build_client as builder  # noqa: E402


def prop_page(*, company="위프코리아", public=True, channels=("유선",), major=False):
    return {
        "id": "talk-page",
        "properties": {
            "상세내용": {"type": "title", "title": [{"plain_text": "판로개척 후속 절차"}]},
            "기업명": {"type": "multi_select", "multi_select": [{"name": company}]},
            "일자": {"type": "date", "date": {"start": "2026-08-31"}},
            "소통형태": {
                "type": "multi_select",
                "multi_select": [{"name": name} for name in channels],
            },
            "주요사항 확인": {"type": "checkbox", "checkbox": major},
            "고객 공개": {"type": "checkbox", "checkbox": public},
        },
    }


class TalkSourceTests(unittest.TestCase):
    def test_query_requires_exact_company_and_public_checkbox(self):
        payload = query_payload(" 위프코리아 ", 100)

        self.assertEqual(payload["filter"], {"and": [
            {"property": "기업명", "multi_select": {"contains": "위프코리아"}},
            {"property": "고객 공개", "checkbox": {"equals": True}},
        ]})

    def test_parse_maps_board_properties_to_customer_talk(self):
        talk = parse_public_talk(prop_page(major=True), "위프코리아")

        self.assertIsNotNone(talk)
        self.assertEqual(talk.page_id, "talk-page")
        self.assertEqual(talk.date, "2026-08-31")
        self.assertEqual(talk.channel, "통화")
        self.assertEqual(talk.title, "판로개척 후속 절차")
        self.assertTrue(talk.major)

    def test_parse_fails_closed_for_unpublished_or_other_company(self):
        self.assertIsNone(parse_public_talk(prop_page(public=False), "위프코리아"))
        self.assertIsNone(
            parse_public_talk(prop_page(company="웰스앤헬스"), "위프코리아")
        )

    def test_parse_maps_all_supported_board_channels(self):
        expected = {
            "유선": "통화",
            "미팅": "미팅",
            "메일": "메일",
            "대면미팅": "미팅",
            "비대면미팅": "미팅",
            "카톡": "카톡",
            "문자": "문자",
        }
        for source, customer in expected.items():
            with self.subTest(source=source):
                talk = parse_public_talk(prop_page(channels=(source,)), "위프코리아")
                self.assertIsNotNone(talk)
                self.assertEqual(talk.channel, customer)

    def test_parse_does_not_guess_ambiguous_channel(self):
        self.assertIsNone(
            parse_public_talk(prop_page(channels=("메일", "유선")), "위프코리아")
        )
        self.assertIsNone(
            parse_public_talk(prop_page(channels=("새 채널",)), "위프코리아")
        )

    def test_builder_reads_public_board_page_and_body(self):
        page = prop_page(major=True)
        blocks = [
            {"id": "heading", "type": "heading_2", "heading_2": {
                "rich_text": [{"plain_text": "판로개척 지원사업"}],
            }},
            {"id": "line", "type": "bulleted_list_item", "bulleted_list_item": {
                "rich_text": [{"plain_text": "중간진도보고서 제출 완료"}],
            }},
            {"id": "todo", "type": "to_do", "to_do": {
                "rich_text": [{"plain_text": "Zoom 요청 확인"}], "checked": False,
            }},
        ]

        class FakeNotion(builder.Notion):
            def __init__(self):
                self.query = None

            def post(self, path, body):
                self.query = (path, body)
                return {"results": [page]}

            def children(self, page_id):
                self.assert_page_id = page_id
                return blocks

        notion = FakeNotion()
        talks = builder.read_talks(notion, "위프코리아")

        self.assertEqual(len(talks), 1)
        self.assertEqual(talks[0]["title"], "판로개척 후속 절차")
        self.assertEqual(talks[0]["channel"], "통화")
        self.assertTrue(talks[0]["major"])
        self.assertEqual(talks[0]["preview"], "판로개척 지원사업")
        self.assertIn("중간진도보고서 제출 완료", talks[0]["body_html"])
        self.assertIn("☐ Zoom 요청 확인", talks[0]["body_html"])
        self.assertEqual(notion.assert_page_id, "talk-page")
        self.assertEqual(notion.query[0], f"/databases/{builder.TALKS_DB_ID}/query")

    def test_builder_reads_all_paginated_public_bodies_without_changing_pm_flags(self):
        import copy
        from datetime import date, timedelta

        pages = []
        for i in range(141):
            page = prop_page(channels=("메일",), major=i % 2 == 0)
            page["id"] = f"talk-{i}"
            page["properties"]["일자"]["date"]["start"] = (date(2026, 10, 7) - timedelta(days=i)).isoformat()
            pages.append(page)
        # 다음 조회 페이지에서 필터가 잘못 적용되어도 고객 데이터는 다시 검증한다.
        pages.insert(101, {**prop_page(company="다른고객"), "id": "other-company"})
        pages.append({**prop_page(public=False), "id": "pm-hidden"})
        unchanged = copy.deepcopy(pages)

        class FakeNotion(builder.Notion):
            def __init__(self):
                self.calls = []
                self.body_reads = []

            def post(self, path, body):
                self.calls.append((path, copy.deepcopy(body)))
                offset = 100 if body.get("start_cursor") == "next-page" else 0
                return {"results": pages[offset:offset + 100], "has_more": offset == 0,
                        "next_cursor": "next-page" if offset == 0 else None}

            def children(self, page_id):
                self.body_reads.append(page_id)
                return [{"type": "paragraph", "paragraph": {
                    "rich_text": [{"plain_text": f"본문 {page_id}"}]}}]

        builder.WARNINGS.clear()
        notion = FakeNotion()
        talks = builder.read_talks(notion, "위프코리아")
        expected = [f"talk-{i}" for i in range(141)]
        self.assertEqual([talk["pid"] for talk in talks], expected)
        self.assertEqual(notion.body_reads, expected)
        self.assertTrue(all(f"본문 {talk['pid']}" in talk["body_html"] for talk in talks))
        self.assertEqual([talk["major"] for talk in talks], [i % 2 == 0 for i in range(141)])
        self.assertEqual(pages, unchanged)
        self.assertEqual(len(notion.calls), 2)
        for path, payload in notion.calls:
            self.assertEqual(path, f"/databases/{builder.TALKS_DB_ID}/query")
            self.assertEqual(payload["filter"], query_payload("위프코리아", 100)["filter"])
            self.assertEqual(payload["sorts"], [{"property": "일자", "direction": "descending"}])
        self.assertEqual(notion.calls[1][1]["start_cursor"], "next-page")
        builder.WARNINGS.clear()


if __name__ == "__main__":
    unittest.main()
