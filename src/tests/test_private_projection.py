import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

import build_client as builder  # noqa: E402


class PrivateProjectionTests(unittest.TestCase):
    def setUp(self):
        self.build_events = builder.build_events
        self.client = {
            "slug": "bowlgames",
            "page_id": "client-page",
            "company_page_id": "company",
            "page_name": "보울게임즈",
        }
        self.patches = [
            patch.object(builder, "fetch_company", return_value={"name": "보울게임즈"}),
            patch.object(builder, "fetch_projects", return_value=[]),
            patch.object(builder, "relay_notice", return_value=None),
            patch.object(builder, "fetch_logo", return_value=(None, None)),
            patch.object(builder, "fetch_recommend", return_value=[]),
            patch.object(builder, "build_talks", return_value=[]),
            patch.object(builder, "read_actions", return_value=([], 0)),
            patch.object(builder, "build_events", return_value=[]),
            patch.object(builder, "build_perf", return_value=(None, [])),
            patch.object(builder, "fetch_material_links", return_value=[]),
            patch.object(builder, "fetch_roadmap", return_value=None),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()

    def test_private_projection_accepts_any_registered_client_in_dry_run(self):
        with patch.object(builder, "fetch_recommend", side_effect=AssertionError(
                "보울게임즈는 옛 재생목록을 읽으면 안 됩니다")):
            result = builder.build_one(
                object(), self.client, False, True, True, {"보울게임즈"},
                private_assets={},
            )

        self.assertEqual(result["slug"], "bowlgames")
        self.assertEqual(result["payload"]["company"]["name"], "보울게임즈")
        self.assertEqual(result["payload"]["recommend"], [])

    def test_missing_legacy_notice_source_is_an_empty_state_not_a_warning(self):
        result = builder.build_one(
            object(), self.client, False, True, True, {"보울게임즈"},
            private_assets={},
        )

        self.assertIsNone(result["payload"]["notice"])
        self.assertEqual(result["warns"], 0)

    def test_private_projection_still_requires_dry_run(self):
        with self.assertRaisesRegex(ValueError, "private_projection_requires_dry_run"):
            builder.build_one(
                object(), self.client, False, False, True, {"보울게임즈"},
                private_assets={},
            )

    def test_project_deadline_stays_in_progress_but_not_schedule_or_next_event(self):
        project = {"title": "메인비즈", "end": "2099-01-01", "badge": "run", "cat": "cert"}
        meeting = {"title": "정기 미팅", "date": "2099-01-02", "kind": "meeting", "past": False}
        with patch.object(builder, "fetch_projects", return_value=[project]), \
                patch.object(builder, "build_events", side_effect=self.build_events), \
                patch.object(builder, "fetch_calendar", return_value=[meeting]):
            payload = builder.build_one(object(), self.client, False, True, True,
                {"보울게임즈"}, private_assets={})["payload"]
        self.assertEqual(payload["progress"], [project])
        self.assertEqual(payload["events"], [meeting])
        self.assertEqual(payload["kpi"]["next"], meeting)


if __name__ == "__main__":
    unittest.main()
