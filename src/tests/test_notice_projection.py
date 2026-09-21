import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from build_client import notice_from_doc  # noqa: E402


def item(kind, html):
    return {"id": f"{kind}-1", "type": kind, "html": html, "items": []}


class NoticeProjectionTests(unittest.TestCase):
    def test_promotes_leading_heading_in_untitled_section(self):
        notice = notice_from_doc({
            "title": "공지사항",
            "date": "2026-09-21",
            "sections": [{
                "id": "section-1",
                "title": "",
                "items": [
                    item("heading2", "보울게임즈 벤처기업인증"),
                    item("todo", "서류 리스트업"),
                ],
            }],
        })

        section = notice["sections"][0]
        self.assertEqual(section["heading_html"], "보울게임즈 벤처기업인증")
        self.assertEqual([row["type"] for row in section["items"]], ["todo"])

    def test_keeps_plain_first_item_in_untitled_section(self):
        notice = notice_from_doc({
            "title": "공지사항",
            "date": "2026-09-21",
            "sections": [{
                "id": "section-1",
                "title": "",
                "items": [item("paragraph", "그대로 보일 안내")],
            }],
        })

        section = notice["sections"][0]
        self.assertIsNone(section["heading"])
        self.assertIsNone(section["heading_html"])
        self.assertEqual(section["items"][0]["html"], "그대로 보일 안내")


if __name__ == "__main__":
    unittest.main()
