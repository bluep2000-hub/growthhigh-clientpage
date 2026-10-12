import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

import transcribe_drive as transcriber  # noqa: E402
import client_mapping  # noqa: E402
from recording_jobs import RecordingJobStore  # noqa: E402


class RecordingInboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / transcriber.INBOX_NAME).mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def audio(self, relative: str, content: bytes = b"audio") -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_unlabelled_and_internal_audio_are_excluded(self):
        for name in ['[TA]블랙크러쉬.m4a', '통화.m4a', '261008_내부_오전미팅.m4a', '261008_위프코리아_통화_1430.m4a.partial']:
            self.audio('수집대기/위프코리아/' + name)
        self.assertEqual(transcriber.plan_sources(self.root, {}, set()), [])

    def test_customer_folder_must_match_label(self):
        self.audio('수집대기/위프코리아/261008_보울게임즈_통화_1430.m4a')
        with self.assertRaisesRegex(transcriber.SourceLayoutError, '라벨이 다릅니다'):
            transcriber.plan_sources(self.root, {}, set())

    def test_only_existing_duplicate_named_inbox_is_used(self):
        (self.root / "수집대기").rmdir()
        self.audio("수집대기 (1)/보울게임즈/261008_보울게임즈_통화_1430.m4a")
        plans = transcriber.plan_sources(self.root, {}, set())
        self.assertEqual(plans[0].source.relative_path, "수집대기 (1)/보울게임즈/261008_보울게임즈_통화_1430.m4a")

    def test_two_inboxes_are_not_guessed(self):
        (self.root / "수집대기 (1)").mkdir()
        with self.assertRaisesRegex(transcriber.SourceLayoutError, "하나로 확정"):
            transcriber.inbox_path(self.root)

    def test_bowlgames_inbox_routes_to_bowlgames_page(self):
        self.audio("수집대기/보울게임즈/260903_보울게임즈_통화_1430.m4a")

        plans = transcriber.plan_sources(self.root, {}, set())

        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0].company, "보울게임즈")
        self.assertEqual(plans[0].client_slug, "bowlgames")
        self.assertEqual(plans[0].stem, "260903_보울게임즈_통화_1430")

    def test_meeting_filename_uses_meeting_channel(self):
        self.audio("수집대기/보울게임즈/260922_보울게임즈_미팅_1600.m4a")

        plans = transcriber.plan_sources(self.root, {}, set())

        self.assertEqual(plans[0].channel, "미팅")
        self.assertTrue(plans[0].stem.endswith("_보울게임즈_미팅_1600"))

    def test_audio_directly_under_inbox_fails_closed(self):
        self.audio("수집대기/261008_위프코리아_통화_1430.m4a")

        with self.assertRaisesRegex(transcriber.SourceLayoutError, "고객사 폴더"):
            transcriber.plan_sources(self.root, {}, set())

    def test_duplicate_content_in_same_customer_is_planned_once(self):
        self.audio("수집대기/위프코리아/261008_위프코리아_통화_1430.m4a", b"same-call")
        self.audio("수집대기/위프코리아/261008_위프코리아_통화_1530.m4a", b"same-call")

        plans = transcriber.plan_sources(self.root, {}, set())

        self.assertEqual(len(plans), 1)

    def test_duplicate_content_across_customers_fails_closed(self):
        self.audio("수집대기/위프코리아/261008_위프코리아_통화_1430.m4a", b"same-call")
        self.audio("수집대기/다른기업/261008_다른기업_통화_1430.m4a", b"same-call")

        with patch.dict(client_mapping.COMPANY_SLUGS, {"다른기업": "other"}), \
                self.assertRaisesRegex(transcriber.SourceLayoutError, "둘 이상의 고객사"):
            transcriber.plan_sources(self.root, {}, set())

    def test_processed_content_in_another_customer_fails_closed(self):
        path = self.audio("수집대기/다른기업/261008_다른기업_통화_1430.m4a", b"same-call")
        digest = transcriber.file_sha256(path)
        ledger = {
            f"sha256:{digest}": "260912_위프코리아_통화",
            f"sha256-company:{digest}": "위프코리아",
        }

        with patch.dict(client_mapping.COMPANY_SLUGS, {"다른기업": "other"}), \
                self.assertRaisesRegex(transcriber.SourceLayoutError, "다른 고객사"):
            transcriber.plan_sources(self.root, ledger, set())

    def test_unregistered_customer_folder_fails_closed(self):
        self.audio("수집대기/위프 코리아/261008_위프 코리아_통화_1430.m4a")

        with self.assertRaisesRegex(transcriber.SourceLayoutError, "등록되지 않은 고객사"):
            transcriber.plan_sources(self.root, {}, set())

    def test_same_path_with_new_content_is_a_new_recording(self):
        path = self.audio("수집대기/위프코리아/261008_위프코리아_통화_1430.m4a", b"new-call")
        ledger = {
            "path:수집대기/위프코리아/261008_위프코리아_통화_1430.m4a": "old-content-digest",
        }

        plans = transcriber.plan_sources(self.root, ledger, set())

        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0].digest, transcriber.file_sha256(path))

    def test_legacy_flat_file_is_not_automatically_accepted(self):
        self.audio("통화 녹음 [위프코리아]담당자_260831_174908.m4a")

        plans = transcriber.plan_sources(self.root, {}, set())

        self.assertEqual(plans, [])

    def test_interrupted_job_keeps_its_original_transcript_name(self):
        audio = self.audio("수집대기/위프코리아/261008_위프코리아_통화_1430.m4a", b"one-call")
        digest = transcriber.file_sha256(audio)
        stem = "260901_위프코리아_통화"

        plans = transcriber.plan_sources(
            self.root,
            {},
            {stem},
            {digest: stem},
        )

        self.assertEqual(plans[0].stem, stem)

    def test_recovers_transcript_saved_just_before_interruption(self):
        audio = self.audio("수집대기/위프코리아/261008_위프코리아_통화_1430.m4a", b"one-call")
        plan = transcriber.plan_sources(self.root, {}, set())[0]
        store = RecordingJobStore(self.root / "jobs.json")
        transcriber.ensure_job(store, plan)
        store.mark_transcribing(plan.digest)
        (self.root / f"{plan.stem}.txt").write_text("화자1: 내용", encoding="utf-8")
        ledger = {}
        ledger_path = self.root / "legacy.json"

        with patch.object(transcriber, "LEDGER", ledger_path):
            count = transcriber.recover_finished_transcripts(
                self.root,
                ledger,
                store,
            )

        self.assertEqual(count, 1)
        self.assertEqual(ledger[f"sha256:{plan.digest}"], plan.stem)
        self.assertEqual(store.get(plan.digest)["state"], "transcribed")
        self.assertTrue(ledger_path.is_file())


if __name__ == "__main__":
    unittest.main()
