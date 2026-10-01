import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import onboard_client as onboarding  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
