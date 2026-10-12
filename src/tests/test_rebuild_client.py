import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from rebuild_client import DEFAULT_RELAY_URL, RebuildClient, RebuildRequestError  # noqa: E402
from check_recording_approvals import pending_jobs


class Response:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self.payload = payload or {"rebuild": "sent"}

    def json(self):
        return self.payload


class Session:
    def __init__(self, response=None):
        self.response = response or Response()
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class RebuildClientTests(unittest.TestCase):
    def test_sends_automation_token_and_slug(self):
        session = Session()
        client = RebuildClient("automation-secret", session=session)

        client.request("whiffkorea")

        url, kwargs = session.calls[0]
        self.assertEqual(
            DEFAULT_RELAY_URL,
            "https://growthhigh-clientpage-private.growthhigh-clientpage-worker.workers.dev",
        )
        self.assertTrue(url.endswith("/ops/rebuild"))
        self.assertEqual(kwargs["json"], {"slug": "whiffkorea"})
        self.assertEqual(
            kwargs["headers"]["Authorization"],
            "Bearer automation-secret",
        )

    def test_missing_token_stops_before_request(self):
        with self.assertRaisesRegex(RebuildRequestError, "AUTOMATION_TOKEN"):
            RebuildClient("")

    def test_worker_failure_is_not_reported_as_complete(self):
        session = Session(Response(payload={"rebuild": "failed"}))
        client = RebuildClient("automation-secret", session=session)

        with self.assertRaisesRegex(RebuildRequestError, "보내지 못했다"):
            client.request("whiffkorea")

    def test_refresh_filters_internal_fields_and_requires_saved_build_key(self):
        def posted(url, **kwargs):
            self.assertTrue(url.endswith("/ops/communications"))
            self.assertEqual(kwargs["json"]["talks"], [{"title": "가상 통화"}])
            return Response(payload={"saved": True, "buildKey": kwargs["json"]["buildKey"]})

        fake = SimpleNamespace(WARNINGS=[], Notion=lambda _: object(),
            fetch_clients=lambda *_: ([{"company_page_id":"company", "page_id":"client"}], set()),
            fetch_company=lambda *_: {"name":"위프코리아"},
            read_talks=lambda *_: [{"pid":"source", "title":"가상 통화", "actions":[]}],
            read_actions=lambda *_: ([], 0),
            public_talk=lambda t: {k:v for k,v in t.items() if k not in ("pid", "actions")})
        session = SimpleNamespace(post=posted)
        def registry(*_):
            fake.WARNINGS.append("다른 기업의 등록 경고")
            return [{"company_page_id":"company", "page_id":"client"}], set()
        fake.fetch_clients = registry
        with patch.dict(sys.modules, {"build_client":fake}), patch.dict("os.environ", {"NOTION_TOKEN":"fake"}):
            client = RebuildClient("fake", session=session)
            client.refresh("whiffkorea", "위프코리아", "source")
            with self.assertRaises(RebuildRequestError):
                client.refresh("bowlgames", "위프코리아", "source")
            with self.assertRaises(RebuildRequestError):
                client.refresh("whiffkorea", "위프코리아", "missing")
            client.session.post = lambda *_args, **_kwargs: Response(payload={"saved":True, "buildKey":"wrong"})
            with self.assertRaises(RebuildRequestError):
                client.refresh("whiffkorea", "위프코리아", "source")

    def test_only_page_failures_and_interrupted_page_builds_retry(self):
        jobs = [{"id":str(i), "state":state, "last_error_code":code} for i,(state,code) in enumerate([
            ("needs_review", "WAITING_PUBLIC_APPROVAL"), ("building", None),
            ("failed", "RebuildRequestError"), ("failed", "TranscriptionError"), ("complete", None)])]
        self.assertEqual([j["id"] for j in pending_jobs(SimpleNamespace(all=lambda:jobs))], ["0","1","2"])


if __name__ == "__main__":
    unittest.main()
