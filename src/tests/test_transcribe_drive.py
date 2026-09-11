import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

import transcribe_drive as transcriber  # noqa: E402
import client_mapping  # noqa: E402


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

    def test_customer_inbox_overrides_untrusted_original_filename(self):
        self.audio("수집대기/위프코리아/[TA]블랙크러쉬.m4a")

        plans = transcriber.plan_sources(self.root, {}, set())

        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0].source.company, "위프코리아")
        self.assertEqual(plans[0].source.channel, "통화")
        self.assertEqual(plans[0].company, "위프코리아")
        self.assertEqual(plans[0].client_slug, "whiffkorea")
        self.assertEqual(plans[0].channel, "통화")
        self.assertEqual(
            plans[0].source.relative_path,
            "수집대기/위프코리아/[TA]블랙크러쉬.m4a",
        )
        self.assertIn("_위프코리아_통화", plans[0].stem)

    def test_audio_directly_under_inbox_fails_closed(self):
        self.audio("수집대기/고객사미지정.m4a")

        with self.assertRaisesRegex(transcriber.SourceLayoutError, "고객사 폴더"):
            transcriber.plan_sources(self.root, {}, set())

    def test_duplicate_content_in_same_customer_is_planned_once(self):
        self.audio("수집대기/위프코리아/첫번째.m4a", b"same-call")
        self.audio("수집대기/위프코리아/두번째.m4a", b"same-call")

        plans = transcriber.plan_sources(self.root, {}, set())

        self.assertEqual(len(plans), 1)

    def test_duplicate_content_across_customers_fails_closed(self):
        self.audio("수집대기/위프코리아/통화.m4a", b"same-call")
        self.audio("수집대기/다른기업/통화.m4a", b"same-call")

        with patch.dict(client_mapping.COMPANY_SLUGS, {"다른기업": "other"}), \
                self.assertRaisesRegex(transcriber.SourceLayoutError, "둘 이상의 고객사"):
            transcriber.plan_sources(self.root, {}, set())

    def test_processed_content_in_another_customer_fails_closed(self):
        path = self.audio("수집대기/다른기업/통화.m4a", b"same-call")
        digest = transcriber.file_sha256(path)
        ledger = {
            f"sha256:{digest}": "260912_위프코리아_통화",
            f"sha256-company:{digest}": "위프코리아",
        }

        with patch.dict(client_mapping.COMPANY_SLUGS, {"다른기업": "other"}), \
                self.assertRaisesRegex(transcriber.SourceLayoutError, "다른 고객사"):
            transcriber.plan_sources(self.root, ledger, set())

    def test_unregistered_customer_folder_fails_closed(self):
        self.audio("수집대기/위프 코리아/통화.m4a")

        with self.assertRaisesRegex(transcriber.SourceLayoutError, "등록되지 않은 고객사"):
            transcriber.plan_sources(self.root, {}, set())

    def test_same_path_with_new_content_is_a_new_recording(self):
        path = self.audio("수집대기/위프코리아/통화.m4a", b"new-call")
        ledger = {
            "path:수집대기/위프코리아/통화.m4a": "old-content-digest",
        }

        plans = transcriber.plan_sources(self.root, ledger, set())

        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0].digest, transcriber.file_sha256(path))

    def test_legacy_flat_file_is_not_automatically_accepted(self):
        self.audio("통화 녹음 [위프코리아]담당자_260831_174908.m4a")

        plans = transcriber.plan_sources(self.root, {}, set())

        self.assertEqual(plans, [])


if __name__ == "__main__":
    unittest.main()
