"""승인된 회의록의 고객 페이지 재빌드를 Worker에 요청한다."""

from __future__ import annotations

import requests


DEFAULT_RELAY_URL = (
    "https://growthhigh-clientpage-relay"
    ".growthhigh-clientpage-worker.workers.dev"
)


class RebuildRequestError(RuntimeError):
    """재빌드 신호를 보내지 못했다."""


class RebuildClient:
    def __init__(self, token: str, *, relay_url: str | None = DEFAULT_RELAY_URL,
                 session: requests.Session | None = None):
        if not token.strip():
            raise RebuildRequestError("AUTOMATION_TOKEN이 없다")
        self.token = token.strip()
        self.relay_url = (relay_url or DEFAULT_RELAY_URL).rstrip("/")
        self.session = session or requests.Session()

    def request(self, slug: str) -> None:
        try:
            response = self.session.post(
                f"{self.relay_url}/ops/rebuild",
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                },
                json={"slug": slug},
                timeout=30,
            )
        except requests.RequestException as exc:
            raise RebuildRequestError("재빌드 중계 서버에 연결하지 못했다") from exc
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code != 200:
            raise RebuildRequestError(
                f"재빌드 요청이 거절됐다({response.status_code})"
            )
        if payload.get("rebuild") != "sent":
            raise RebuildRequestError(
                f"재빌드 신호를 보내지 못했다({payload.get('rebuild') or 'unknown'})"
            )
