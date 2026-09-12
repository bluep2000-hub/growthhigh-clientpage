import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from rebuild_client import RebuildClient, RebuildRequestError  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
