import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import onboard_client as onboarding  # noqa: E402
import client_mapping  # noqa: E402


class OnboardTests(unittest.TestCase):
    def test_material_names_use_exact_company_boundary(self):
        self.assertTrue(onboarding.material_for("2026-09-04 웰던프로덕트 - 1st 자료", "웰던프로덕트"))
        self.assertFalse(onboarding.material_for("2026-09-04 웰던프로덕트랩 - 1st 자료", "웰던프로덕트"))
        self.assertTrue(onboarding.material_for("2025-09-04  (주)동선컴퍼니- 2nd 자료", "동선컴퍼니"))
        self.assertFalse(onboarding.material_for("2025-09-04 (주)동선컴퍼니랩 - 2nd 자료", "동선컴퍼니"))

    def test_duplicate_company_requires_verified_matching_id(self):
        class Notion:
            def query_all(self, db, query=None):
                return [{"id":"active-client"},{"id":"old-lead"}] if db == onboarding.b.COMPANY_DB_ID else []
        with self.assertRaisesRegex(ValueError,"2건"):
            onboarding.page_state(Notion(),"동선컴퍼니","dongseoncompany")
        company,*_=onboarding.page_state(Notion(),"동선컴퍼니","dongseoncompany","active-client")
        self.assertEqual(company["id"],"active-client")
        with self.assertRaisesRegex(ValueError,"0건"):
            onboarding.page_state(Notion(),"동선컴퍼니","dongseoncompany","unrelated")

    def test_unpublished_material_is_not_linked_to_new_page(self):
        rows = [
            {"id": "published", "public_url": "https://example.com", "properties": {
                "페이지명": {"title": [{"plain_text": "2026-09-04 웰던프로덕트 - 1st 자료"}]}}},
            {"id": "private", "public_url": None, "properties": {
                "페이지명": {"title": [{"plain_text": "웰던프로덕트 사전진단리포트"}]}}},
        ]
        blocks = onboarding.initial_blocks("company", rows)
        self.assertEqual(sum(x["type"] == "bulleted_list_item" for x in blocks), 1)
        self.assertIn("📁 데이터룸 · 주요 자료", str(blocks))
        self.assertIn("컨설팅 타임테이블", str(blocks))
        self.assertEqual(blocks[-1]["type"], "table")
        self.assertEqual(len(blocks[-1]["table"]["children"]), 1)

    def test_exact_page_wins_over_foreign_pages_with_wrong_relation(self):
        def page(pid, name, company="active"):
            return {"id": pid, "properties": {
                "페이지명": {"title": [{"plain_text": name + " 클라이언트페이지"}]},
                "페이지 유형": {"multi_select": [{"name": onboarding.b.CLIENT_PAGE_TYPE}]},
                "기업 DB": {"relation": [{"id": company}]}}}
        rows = [page("own", "프로젝트모름"), page("foreign", "펀스테이")]
        class Notion:
            def query_all(self, db, query=None):
                return [{"id": "active"}] if db == onboarding.b.COMPANY_DB_ID else rows
        self.assertEqual(onboarding.page_state(Notion(), "프로젝트모름", "projectmoreum")[1]["id"], "own")
        rows[0] = page("own", "프로젝트모름", "other")
        with self.assertRaisesRegex(ValueError, "기업 연결이 다릅니다"):
            onboarding.page_state(Notion(), "프로젝트모름", "projectmoreum")

    def test_prepare_creates_only_customer_recording_folder_and_mapping(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inbox = root / "수집대기"
            inbox.mkdir()
            with patch.dict(onboarding.os.environ, {"TALKS_DIR": str(root)}), \
                 patch.object(client_mapping, "MAPPING_FILE", root / "clients.json"):
                onboarding.ensure_recording_folder("웰던프로덕트", "welldoneproduct")
                onboarding.ensure_recording_folder("웰던프로덕트", "welldoneproduct")
                self.assertTrue((inbox / "웰던프로덕트").is_dir())
                self.assertEqual(client_mapping.client_slug_for("웰던프로덕트"), "welldoneproduct")

    def test_mail_never_writes_without_reviewed_message_id(self):
        with patch.object(onboarding.b, "fetch_mails") as fetch:
            with self.assertRaisesRegex(ValueError, "Message-ID"):
                onboarding.mail(None, "사유존", set(), "page", [])
            fetch.assert_not_called()

    def test_mail_rejects_id_missing_from_current_fetch(self):
        with patch.dict(onboarding.os.environ, {
            "IMAP_HOST": "test", "IMAP_USER": "test", "IMAP_PASS": "test"}), \
             patch.object(onboarding.b, "fetch_mails", return_value=[]), \
             patch.object(onboarding.b, "sync_mails_to_notion") as sync:
            with self.assertRaisesRegex(ValueError, "찾지 못한"):
                onboarding.mail(None, "사유존", set(), "page", ["approved-id"])
            sync.assert_not_called()


if __name__ == "__main__":
    unittest.main()
