import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from summarize_transcript import SummaryNeedsReview, validate_summary  # noqa: E402


VALID_MINUTES = """## 1. 지원사업 서류 진행

- 신청서 초안을 검토하기로 함

---

## 2. 향후 일정 및 Action Items

| 항목 | 담당 | 기한 |
| --- | --- | --- |
| 신청서 초안 검토 | 그로스하이 | 9월 15일 |
"""


class SummaryValidationTests(unittest.TestCase):
    def test_accepts_minutes_with_exact_action_table(self):
        summary = validate_summary("지원사업 서류 협의", VALID_MINUTES)

        self.assertEqual(summary.title, "지원사업 서류 협의")
        self.assertIn("Action Items", summary.minutes_markdown)

    def test_allows_action_table_without_invented_rows(self):
        minutes = """## 1. 진행 상황

- 현재 상황을 공유함

## 2. Action Items

| 항목 | 담당 | 기한 |
| --- | --- | --- |
"""

        summary = validate_summary("진행 상황 공유", minutes)

        self.assertEqual(summary.title, "진행 상황 공유")

    def test_rejects_title_over_25_characters(self):
        with self.assertRaisesRegex(SummaryNeedsReview, "25자"):
            validate_summary("가" * 26, VALID_MINUTES)

    def test_rejects_section_after_action_items(self):
        minutes = VALID_MINUTES + "\n## 3. 뒤에 생긴 안건\n\n- 내용"

        with self.assertRaisesRegex(SummaryNeedsReview, "마지막 섹션"):
            validate_summary("지원사업 서류 협의", minutes)

    def test_rejects_unapproved_owner_name(self):
        minutes = VALID_MINUTES.replace("그로스하이", "박재현")

        with self.assertRaisesRegex(SummaryNeedsReview, "담당"):
            validate_summary("지원사업 서류 협의", minutes)

    def test_rejects_missing_action_items_header(self):
        minutes = VALID_MINUTES.replace("| 항목 | 담당 | 기한 |", "| 할일 | 담당 | 날짜 |")

        with self.assertRaisesRegex(SummaryNeedsReview, "머리 행"):
            validate_summary("지원사업 서류 협의", minutes)


if __name__ == "__main__":
    unittest.main()
