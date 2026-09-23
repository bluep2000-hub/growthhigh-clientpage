import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

import build_client as builder  # noqa: E402


class MailFallbackTests(unittest.TestCase):
    def test_mail_table_keeps_empty_cell_and_row_relationship(self):
        raw = ('<p>안내드립니다.</p><table><tr><td>구분</td><td>상세 내용</td></tr>'
               '<tr><td>일시</td><td>일정 검토 후 확정<br>다음 안내 예정</td></tr>'
               '<tr><td>장소</td><td></td></tr><tr><td>준비</td><td>자료 준비</td></tr></table>')
        blocks = builder.mail_body_blocks(builder.clean_body(raw, True))
        table = next(b['table'] for b in blocks if b['type'] == 'table')
        cells = table['children']
        self.assertEqual(table['table_width'], 2)
        self.assertEqual(cells[1]['table_row']['cells'][0][0]['text']['content'], '일시')
        self.assertEqual(cells[2]['table_row']['cells'][1], [])
        self.assertEqual(cells[3]['table_row']['cells'][1][0]['text']['content'], '자료 준비')

    def test_layout_table_is_not_promoted_to_data_table(self):
        body = builder.clean_body('<table><tr><td>안녕하세요.</td></tr></table>', True)
        self.assertFalse(any(b['type'] == 'table' for b in builder.mail_body_blocks(body)))

    def test_mail_table_preserves_merged_row_labels(self):
        raw = ('<table><tr><td>구분</td><td>상세 내용</td></tr>'
               '<tr><td rowspan="2">일시</td><td>첫 안내</td></tr>'
               '<tr><td>추가 안내</td></tr></table>')
        table = builder.mail_body_blocks(builder.clean_body(raw, True))[0]['table']
        rows = table['children']
        self.assertEqual(rows[2]['table_row']['cells'][0][0]['text']['content'], '일시')
        self.assertEqual(rows[2]['table_row']['cells'][1][0]['text']['content'], '추가 안내')

    def test_html_mail_keeps_paragraph_and_list_breaks(self):
        body = builder.clean_body("<p>안녕하세요.</p><p>확인 사항:</p><ul><li>첫째</li><li>둘째</li></ul>", True)
        self.assertEqual(body, "안녕하세요.\n확인 사항:\n첫째\n둘째")

    def test_shared_folder_keeps_only_exact_company_subject_tag(self):
        mails = [
            {"title": "[보울게임즈] 방문세션 안내"},
            {"title": "[리마인드][보울게임즈] 방문세션 안내"},
            {"title": "[에이블게임즈] 방문세션 안내"},
            {"title": "보울게임즈 방문세션 안내"},
        ]

        found = builder.shared_folder_mails(
            mails, "보울게임즈", {"보울게임즈", "에이블게임즈"})

        self.assertEqual(found, mails[:2])

    def test_shared_folder_does_not_confuse_similar_company_names(self):
        mails = [
            {"title": "[보울] 자료 요청"},
            {"title": "[보울게임즈] 자료 요청"},
        ]

        found = builder.shared_folder_mails(
            mails, "보울게임즈", {"보울", "보울게임즈"})

        self.assertEqual(found, [mails[1]])

    def test_mail_board_entry_is_public_by_default_and_deduplicated(self):
        mail = {
            "date": "2026-09-14",
            "title": "[보울게임즈] 계약 진행 안내",
            "body": "계약 진행 내용을 안내합니다.",
        }

        class FakeNotion:
            def __init__(self):
                self.created = []

            def query_all(self, database_id, body):
                self.database_id = database_id
                self.query = body
                return [{"properties": {
                    "일자": {"type": "date", "date": {"start": "2026-09-14"}},
                    "상세내용": {"type": "title", "title": [
                        {"plain_text": "[보울게임즈] 이미 있는 메일"},
                    ]},
                }}]

            def post(self, path, body):
                self.created.append((path, body))
                return {}

        notion = FakeNotion()
        builder.sync_mails_to_board(notion, "보울게임즈", [
            mail,
            {**mail, "title": "[보울게임즈] 이미 있는 메일"},
        ])

        self.assertEqual(notion.database_id, builder.TALKS_DB_ID)
        self.assertEqual(len(notion.created), 1)
        path, payload = notion.created[0]
        self.assertEqual(path, "/pages")
        props = payload["properties"]
        self.assertTrue(props["고객 공개"]["checkbox"])
        self.assertFalse(props["주요사항 확인"]["checkbox"])
        self.assertEqual(props["기업명"]["multi_select"], [{"name": "보울게임즈"}])
        self.assertEqual(props["소통형태"]["multi_select"], [{"name": "메일"}])


if __name__ == "__main__":
    unittest.main()
