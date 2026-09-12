import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from recording_jobs import (  # noqa: E402
    PipelineAlreadyRunning,
    RecordingJobError,
    RecordingJobStore,
)


class RecordingJobStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "state" / "jobs.json"
        self.store = RecordingJobStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def create_job(self) -> dict:
        return self.store.ensure_received(
            job_id="a" * 64,
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

    def test_persists_progress_without_audio_or_transcript_body(self):
        job = self.create_job()
        self.assertEqual(job["state"], "received")

        self.store.mark_transcribing(job["id"])
        saved = RecordingJobStore(self.path).get(job["id"])

        self.assertEqual(saved["state"], "transcribing")
        self.assertEqual(saved["attempts"], 1)
        raw = self.path.read_text(encoding="utf-8")
        self.assertNotIn("화자1", raw)

    def test_failure_is_short_and_single_line(self):
        job = self.create_job()
        self.store.mark_failed(job["id"], RuntimeError("첫 줄\n" + "x" * 500))

        saved = self.store.get(job["id"])

        self.assertEqual(saved["state"], "failed")
        self.assertEqual(saved["last_error_code"], "RuntimeError")
        self.assertNotIn("\n", saved["last_error_detail"])
        self.assertLessEqual(len(saved["last_error_detail"]), 300)

    def test_existing_job_cannot_move_to_another_customer(self):
        job = self.create_job()

        with self.assertRaisesRegex(RecordingJobError, "다른 고객사"):
            self.store.ensure_received(
                job_id=job["id"],
                source_relative_path="수집대기/다른기업/통화.m4a",
                source_name="통화.m4a",
                source_size=123,
                source_modified_at="2026-09-12T01:02:03+09:00",
                company_name="다른기업",
                company_slug="other",
                channel="통화",
                occurred_at="2026-09-12",
                transcript_name="260912_다른기업_통화.txt",
            )

    def test_corrupt_ledger_stops_instead_of_resetting_history(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("not-json", encoding="utf-8")

        with self.assertRaisesRegex(RecordingJobError, "읽을 수 없다"):
            self.store.all()

    def test_saved_file_has_versioned_shape(self):
        self.create_job()

        saved = json.loads(self.path.read_text(encoding="utf-8"))

        self.assertEqual(saved["schema_version"], 1)
        self.assertEqual(len(saved["jobs"]), 1)

    def test_pipeline_lock_blocks_a_second_run_then_releases(self):
        first = self.store.run_lock()
        second = self.store.run_lock()

        first.acquire()
        with self.assertRaises(PipelineAlreadyRunning):
            second.acquire()
        first.release()
        second.acquire()
        second.release()

        self.assertFalse(self.path.with_suffix(".lock").exists())

    def test_stale_pipeline_lock_is_recovered(self):
        first = self.store.run_lock()
        first.acquire()
        lock_path = self.path.with_suffix(".lock")
        old = lock_path.stat().st_mtime - first.STALE_AFTER_SECONDS - 1
        os.utime(lock_path, (old, old))

        second = self.store.run_lock()
        second.acquire()
        second.release()

        self.assertFalse(lock_path.exists())


if __name__ == "__main__":
    unittest.main()
