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


if __name__ == "__main__":
    unittest.main()
