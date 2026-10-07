import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

import build_client as builder  # noqa: E402


class MailFallbackTests(unittest.TestCase):
    def test_full_history_scans_headers_in_bounded_batches(self):
        class Mailbox:
            def __init__(self):
                self.ranges = []

            def select(self, *_args, **_kwargs):
                return "OK", [b"601"]

            def fetch(self, span, _spec):
                self.ranges.append(span)
                first = span.split(":")[0]
                return "OK", [(f"{first} (BODY[HEADER])".encode(), b"header")]

        box = Mailbox()
        with patch.object(builder, "TALKS_SCAN_MAX", 601), \
             patch.object(builder, "parse_header", return_value={"date": "2026-10-01"}):
            mails, count = builder.scan_folder(box, "Inbox.test", 0)
        self.assertEqual(box.ranges, ["1:300", "301:600", "601:601"])
        self.assertEqual((len(mails), count), (3, 601))

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
                if database_id == builder.MAIL_TALKS_DB_ID:
                    return []
                self.database_id = database_id
                self.query = body
                return [{"properties": {
                    "일자": {"type": "date", "date": {"start": "2026-09-14"}},
                    "상세내용": {"type": "title", "title": [
                        {"plain_text": "[보울게임즈] 이미 있는 메일"},
                    ]},
                    "URL": {"url": "https://app.notion.com/p/source#mail-v1-" + builder.mail_board_key(
                        {**mail, "title": "[보울게임즈] 이미 있는 메일"})},
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

    def test_first_mail_creates_new_company_option(self):
        class FakeNotion:
            def __init__(self):
                self.created = []

            def query_all(self, database_id, _body):
                if database_id == builder.TALKS_DB_ID:
                    raise builder.ClientFailure('multi_select option \\"새고객\\" not found for property \\"기업명\\"')
                return []

            def post(self, path, body):
                self.created.append((path, body))
                return {}

        notion = FakeNotion()
        builder.sync_mails_to_board(notion, "새고객", [{
            "date": "2026-10-01", "title": "[새고객] 안내", "body": "안내 내용",
        }])
        self.assertEqual(len(notion.created), 1)
        self.assertEqual(notion.created[0][1]["properties"]["기업명"]["multi_select"],
                         [{"name": "새고객"}])

    def test_mail_variants_survive_partial_replay_and_pm_edits(self):
        import copy

        base = {"date": "2026-01-19", "title": "[고객] 자료 안내"}
        mails = [{**base, "body": text, "message_id": str(i)}
                 for i, text in enumerate(("첫 안내 내용", "추가 자료 요청", "고객 회신 내용"))]

        class FakeNotion:
            def __init__(self, source_mails, legacy_mail, edited_body=None):
                self.sources = [{"id": f"source-{i}", "properties": {
                    "일자": {"date": {"start": m["date"]}},
                    "제목": {"title": [{"plain_text": m["title"]}]},
                    "요약": {"rich_text": [{"plain_text": m["body"]}]},
                }} for i, m in enumerate(source_mails)]
                self.rows = [{"id": "legacy", "properties": {
                    "일자": {"date": {"start": legacy_mail["date"]}},
                    "상세내용": {"title": [{"plain_text": legacy_mail["title"]}]},
                    "고객 공개": {"checkbox": False},
                }}]
                self.bodies = {"legacy": builder.mail_body_blocks(edited_body or legacy_mail["body"])}
                self.created = 0
                self.fail_next = False

            def query_all(self, database_id, _body):
                return self.sources if database_id == builder.MAIL_TALKS_DB_ID else self.rows

            def children(self, block_id):
                return self.bodies[block_id]

            def patch(self, path, payload):
                row = next(r for r in self.rows if r["id"] == path.rsplit("/", 1)[-1])
                row["properties"].update(payload["properties"])

            def post(self, _path, payload):
                if self.fail_next:
                    self.fail_next = False
                    raise builder.ClientFailure("임시 저장 실패")
                self.created += 1
                row_id = f"created-{self.created}"
                props = copy.deepcopy(payload["properties"])
                for run in props["상세내용"]["title"]:
                    run["plain_text"] = run["text"]["content"]
                self.rows.append({"id": row_id, "properties": props})
                self.bodies[row_id] = copy.deepcopy(payload.get("children") or [])
                return {"id": row_id}

        builder.WARNINGS.clear()
        notion = FakeNotion(mails, mails[0])
        original = copy.deepcopy(notion.bodies["legacy"])
        notion.fail_next = True
        builder.sync_mails_to_board(notion, "고객", mails + [{**mails[2], "message_id": "other-recipient"}])
        self.assertEqual(notion.created, 1)
        self.assertTrue(builder.WARNINGS)
        builder.WARNINGS.clear()

        # 부분 재수집도 원본 전체를 읽고 빠졌던 다른 본문만 복구한다.
        builder.sync_mails_to_board(notion, "고객", [mails[1]])
        self.assertEqual(notion.created, 2)
        self.assertEqual(builder.mail_board_saved_keys(notion.rows),
                         {builder.mail_board_key(m) for m in mails})
        self.assertEqual(notion.bodies["legacy"], original)
        self.assertFalse(notion.rows[0]["properties"]["고객 공개"]["checkbox"])
        notion.bodies["legacy"] = builder.mail_body_blocks("담당자가 수정한 본문")
        builder.sync_mails_to_board(notion, "고객", mails)
        self.assertEqual(notion.created, 2)
        self.assertEqual(notion.bodies["legacy"], builder.mail_body_blocks("담당자가 수정한 본문"))

        # 아직 식별자를 못 붙인 PM 편집 행: 원본 하나는 연결, 여러 본문이면 경고.
        edited = FakeNotion([mails[0]], mails[0], "PM 편집 내용")
        builder.sync_mails_to_board(edited, "고객", [mails[0]])
        self.assertEqual(edited.created, 0)
        self.assertEqual(builder.mail_board_saved_keys(edited.rows), {builder.mail_board_key(mails[0])})
        ambiguous = FakeNotion(mails, mails[0], "PM 편집 내용")
        builder.sync_mails_to_board(ambiguous, "고객", [mails[1]])
        self.assertEqual(ambiguous.created, 0)
        self.assertFalse(builder.mail_board_saved_keys(ambiguous.rows))
        self.assertTrue(builder.WARNINGS)
        builder.WARNINGS.clear()

    def test_onboarding_verification_rejects_missing_same_title_body(self):
        import os
        import onboard_client as onboard

        mails = [{"date": "2026-01-19", "title": "[고객] 안내",
                  "body": body, "message_id": str(i)}
                 for i, body in enumerate(("첫 본문", "서로 다른 두 번째 본문"))]

        class FakeNotion:
            def query_all(self, database_id, _query):
                if database_id == builder.MAIL_TALKS_DB_ID:
                    return [{"properties": {"Message-ID": {"rich_text": [
                        {"plain_text": m["message_id"]}]}}} for m in mails]
                return [{"properties": {"URL": {"url": "https://app.notion.com/p/source#mail-v1-" +
                                                builder.mail_board_key(mails[0])}}}]

        with patch.dict(os.environ, {"IMAP_HOST": "test", "IMAP_USER": "test", "IMAP_PASS": "test"}), \
             patch.object(builder, "fetch_mails", return_value=mails), \
             patch.object(builder, "sync_mails_to_notion"), \
             patch.object(builder, "sync_mails_to_board"):
            with self.assertRaisesRegex(ValueError, "누락"):
                onboard.mail(FakeNotion(), "고객", {"고객"}, "client", ["0", "1"])


if __name__ == "__main__":
    unittest.main()
