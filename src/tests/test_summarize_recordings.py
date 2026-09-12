import sys
import tempfile
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from recording_jobs import RecordingJobStore  # noqa: E402
from summarize_recordings import pending_jobs, read_summary, write_summary  # noqa: E402
from summarize_transcript import MeetingSummary, SummaryNeedsReview  # noqa: E402


MINUTES = """## 1. 진행 상황

- 서류를 검토함

## 2. Action Items

| 항목 | 담당 | 기한 |
| --- | --- | --- |
| 서류 전달 | 클라이언트 | 미정 |
"""


class SummarizeRecordingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = RecordingJobStore(self.root / "jobs.json")
        self.job = self.store.ensure_received(
            job_id="b" * 64,
            source_relative_path="수집대기/위프코리아/통화.m4a",
            source_name="통화.m4a",
            source_size=123,
            source_modified_at="2026-09-12T01:02:03+09:00",
            company_name="위프코리아",
            company_slug="whiffkorea",
            channel="통화",
            occurred_at="2026-09-12",
            transcript_name="260912_위프코리아_통화.txt",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_only_transcribed_or_interrupted_summary_jobs_are_pending(self):
        self.assertEqual(pending_jobs(self.store), [])
        self.store.mark_transcribed(self.job["id"])
        self.assertEqual(len(pending_jobs(self.store)), 1)
        self.store.mark_summarizing(self.job["id"])
        self.assertEqual(len(pending_jobs(self.store)), 1)
        self.store.mark_notion_writing(self.job["id"], "draft.json")
        self.assertEqual(pending_jobs(self.store), [])

    def test_summary_artifact_round_trips(self):
        path = self.root / "draft.json"
        original = MeetingSummary("진행 상황 공유", MINUTES)

        write_summary(path, original)
        restored = read_summary(path)

        self.assertEqual(restored.title, original.title)
        self.assertEqual(restored.minutes_markdown, original.minutes_markdown.strip())

    def test_corrupt_summary_artifact_needs_review(self):
        path = self.root / "draft.json"
        path.write_text("not-json", encoding="utf-8")

        with self.assertRaises(SummaryNeedsReview):
            read_summary(path)


if __name__ == "__main__":
    unittest.main()
