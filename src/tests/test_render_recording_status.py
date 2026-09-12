import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from render_recording_status import (  # noqa: E402
    next_stale_at,
    render_page,
    safe_notion_url,
    write_page,
)


def job(**extra):
    return {
        "id": "a" * 64,
        "company_name": "위프코리아",
        "source_name": "통화녹음.m4a",
        "occurred_at": "2026-09-12",
        "channel": "통화",
        "state": "complete",
        "updated_at": "2026-09-12T01:00:00+00:00",
        **extra,
    }


class RecordingStatusPageTests(unittest.TestCase):
    def test_page_escapes_filename_and_omits_unknown_fields(self):
        page = render_page(
            [job(source_name="<script>alert(1)</script>.m4a",
                 transcript_text="외부로 보이면 안 되는 전사 본문")],
            rendered_at=datetime(2026, 9, 12, 2, 0, tzinfo=timezone.utc),
        )

        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;.m4a", page)
        self.assertNotIn("<script>alert(1)</script>", page)
        self.assertNotIn("외부로 보이면 안 되는 전사 본문", page)

    def test_waiting_approval_links_only_to_notion(self):
        page = render_page([job(
            state="needs_review",
            last_error_code="WAITING_PUBLIC_APPROVAL",
            notion_url="https://www.notion.so/example",
        )])

        self.assertIn("승인 대기", page)
        self.assertIn("Notion 초안 열기", page)
        self.assertIsNone(safe_notion_url("https://example.com/fake-notion"))

    def test_failed_job_tells_pm_how_to_get_help(self):
        page = render_page([job(
            state="failed",
            last_error_code="ClientError",
            last_error_detail="회의록 생성 실패",
        )])

        self.assertIn("확인이 필요한 항목이 1건 있습니다", page)
        self.assertIn("자동화 확인 필요", page)
        self.assertIn("회의록 생성 실패", page)

    def test_page_is_written_atomically(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "status.html"
            write_page(path, "첫 화면")
            write_page(path, "새 화면")

            self.assertEqual(path.read_text(encoding="utf-8"), "새 화면")
            self.assertEqual(list(path.parent.glob(".*.tmp")), [])

    def test_stale_warning_waits_until_after_the_next_scheduled_run(self):
        seoul = timezone(timedelta(hours=9))
        rendered_at = datetime(2026, 9, 12, 18, 5, tzinfo=seoul)

        self.assertEqual(
            next_stale_at(rendered_at),
            datetime(2026, 9, 13, 10, 30, tzinfo=seoul),
        )
        page = render_page([], rendered_at=rendered_at)
        self.assertIn('data-stale-after="2026-09-13T10:30:00+09:00"', page)
        self.assertIn("마지막 자동 확인이 예정 시각보다 늦었습니다", page)
        self.assertIn("현재 처리 상태를 확인할 수 없습니다", page)
        self.assertIn("마지막 저장 기준", page)


if __name__ == "__main__":
    unittest.main()
