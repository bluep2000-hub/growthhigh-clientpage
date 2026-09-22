import sys
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_client as builder  # noqa: E402


def block(kind, text="", url=None):
    run = {"plain_text": text, "href": url}
    return {"type": kind, kind: {"rich_text": [run]}, "has_children": False}


class RoomLinksTests(unittest.TestCase):
    def test_unpublished_notion_page_is_not_given_to_customers(self):
        class Notion:
            def children(self, page_id):
                return [block("heading_2", "주요 자료"),
                        block("bulleted_list_item", "미게시 문서",
                              "https://app.notion.com/p/3ce815d712b980cc9a43c455e3d80ddf")]

            def get(self, path):
                return {"public_url": None}

        with patch.object(builder, "log") as notice:
            self.assertEqual(builder.fetch_material_links(Notion(), "client-page"), [])
        notice.assert_called_once()

    def test_nested_and_bookmark_links_under_materials_are_collected(self):
        parent = block("bulleted_list_item", "자료 묶음")
        parent.update(id="nested", has_children=True)
        blocks = [block("heading_2", "🔗 주요 자료"), parent,
                  {"type": "bookmark", "bookmark": {"url": "https://example.com/document",
                   "caption": [{"plain_text": "참고 문서"}]}}]

        class Notion:
            def children(self, page_id):
                return [block("bulleted_list_item", "미팅 자료", "https://example.com/meeting"),
                        block("bulleted_list_item", "잘못된 링크", "javascript:alert(1)")] \
                    if page_id == "nested" else blocks

        self.assertEqual(builder.fetch_material_links(Notion(), "client-page"), [
            {"group": "주요 자료", "items": [
                {"label": "미팅 자료", "url": "https://example.com/meeting"},
                {"label": "참고 문서", "url": "https://example.com/document"},
            ]},
        ])

    def test_only_material_links_are_added_without_duplicate_guidebook_or_manual_link(self):
        first = "https://app.notion.com/p/3ce815d712b980cc9a43c455e3d80ddf"
        second = "https://app.notion.com/p/3d6815d712b980eeaf48f00488529ea3"
        public_first = "https://yuncommon.notion.site/2026-09-01-1st-3ce815d712b980cc9a43c455e3d80ddf"
        public_second = "https://yuncommon.notion.site/2026-09-10-2nd-3d6815d712b980eeaf48f00488529ea3"
        blocks = [
            block("bulleted_list_item", "내부 기업 정보", "https://app.notion.com/p/internal"),
            block("heading_2", "🔗 주요 자료"),
            block("bulleted_list_item", "그로스하이 가이드북",
                  "https://app.notion.com/p/f12815d712b982d3af19812af6f50cbe"),
            block("bulleted_list_item", "2026-09-01 보울게임즈 1차 자료", first),
            block("bulleted_list_item", "2026-09-10 보울게임즈 2차 자료", second),
            block("divider"),
            block("bulleted_list_item", "다른 섹션", "https://example.com/private"),
        ]

        class Notion:
            def children(self, page_id):
                self.page_id = page_id
                return blocks

            def get(self, path):
                return {"public_url": public_first if path.endswith(first[-32:]) else public_second}

        nt = Notion()
        with patch.object(builder, "fetch_company", return_value={"name": "보울게임즈"}), \
             patch.object(builder, "fetch_projects", return_value=[]), \
             patch.object(builder, "relay_notice", return_value=None), \
             patch.object(builder, "fetch_logo", return_value=(None, None)), \
             patch.object(builder, "fetch_recommend", return_value=[]), \
             patch.object(builder, "build_talks", return_value=[]), \
             patch.object(builder, "read_actions", return_value=([], 0)), \
             patch.object(builder, "build_events", return_value=[]), \
             patch.object(builder, "build_perf", return_value=(None, [])), \
             patch.object(builder, "fetch_roadmap", return_value=None):
            result = builder.build_one(nt, {
                "slug": "bowlgames", "page_id": "bowlgames-page", "page_name": "보울게임즈",
                "company_page_id": "company", "extra_links": [
                    {"group": "기존 자료", "items": [{"label": "수동 자료", "url": public_first}]},
                ],
            }, False, True, True, {"보울게임즈"}, private_assets={})

        self.assertEqual(nt.page_id, "bowlgames-page")
        self.assertEqual(result["payload"]["company"]["extra_links"], [
            {"group": "기존 자료", "items": [{"label": "수동 자료", "url": public_first}]},
            {"group": "주요 자료", "items": [
                {"label": "2026-09-10 보울게임즈 2차 자료", "url": public_second},
            ]},
        ])


if __name__ == "__main__":
    unittest.main()
