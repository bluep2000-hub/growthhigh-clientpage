"""공개 회의록의 고객 페이지 재빌드를 Worker에 요청한다."""

from __future__ import annotations

import requests

import contextlib
import io
import os
import time
import uuid


DEFAULT_RELAY_URL = (
    "https://growthhigh-clientpage-private"
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

    def refresh(self, slug: str, company: str, page_id: str) -> None:
        """기존 공개 소통 수집기를 쓰고 실제 저장 확인 뒤에만 완료한다."""
        from client_mapping import client_slug_for
        import build_client as builder

        started = int(time.time() * 1000)
        build_key = str(uuid.uuid4())
        try:
            if client_slug_for(company) != slug:
                raise ValueError("customer_mismatch")
            with contextlib.redirect_stdout(io.StringIO()):
                nt = builder.Notion(os.environ["NOTION_TOKEN"])
                clients, _ = builder.fetch_clients(nt, slug)
                if len(clients) != 1:
                    raise ValueError("expected_one_client")
                name = builder.fetch_company(nt, clients[0]["company_page_id"])["name"]
                if name != company:
                    raise ValueError("customer_mismatch")
                before = len(builder.WARNINGS)
                talks = builder.read_talks(nt, name)
                actions, done = builder.read_actions(nt, clients[0]["page_id"], talks)
                if len(builder.WARNINGS) != before or not any(t["pid"] == page_id for t in talks):
                    raise ValueError("incomplete_communications")
                public = [builder.public_talk(t) for t in talks]
            response = self.session.post(
                f"{self.relay_url}/ops/communications",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={"slug": slug, "company": name, "startedAt": started,
                      "buildKey": build_key, "talks": public,
                      "actions": actions, "actions_done": done}, timeout=60,
            )
            result = response.json()
            if response.status_code != 200 or result.get("saved") is not True or result.get("buildKey") != build_key:
                raise ValueError("communications_not_saved")
        except Exception as exc:
            # 인증값·Notion 원본·본문이 처리 장부나 로그에 남지 않는다.
            raise RebuildRequestError("고객 소통 갱신 실패: 기존 정상 페이지를 유지합니다") from exc

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
