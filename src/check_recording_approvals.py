#!/usr/bin/env python3
"""PM이 고객 공개를 승인한 회의록을 찾아 고객 페이지 재빌드를 요청한다."""

from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from notion_talk_drafts import NotionDraftClient, NotionDraftError
from rebuild_client import RebuildClient, RebuildRequestError
from recording_jobs import RecordingJobError, RecordingJobStore


ROOT = Path(__file__).resolve().parent.parent


def pending_jobs(store: RecordingJobStore) -> list[dict]:
    return sorted(
        (job for job in store.all()
         if job.get("state") == "needs_review"
         and job.get("last_error_code") == "WAITING_PUBLIC_APPROVAL"),
        key=lambda job: (job.get("received_at") or "", job.get("id") or ""),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="회의록 고객 공개 승인 확인기")
    parser.add_argument("--dry-run", action="store_true",
                        help="승인 대기 목록만 보고 외부 서비스를 건드리지 않는다")
    parser.add_argument("--limit", metavar="개수", type=int, default=None)
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    try:
        store = RecordingJobStore()
        todo = pending_jobs(store)
    except RecordingJobError as exc:
        print(f"처리 장부 확인 필요:\n{exc}")
        return 1
    if args.limit:
        todo = todo[:args.limit]
    if not todo:
        print("고객 공개 승인을 기다리는 회의록이 없다.")
        return 0

    print(f"고객 공개 승인 대기 {len(todo)}건")
    for job in todo:
        print(f"  {job.get('company_name')} · {job.get('occurred_at')}")
    if args.dry_run:
        print("dry-run 이라 여기서 멈춘다.")
        return 0

    try:
        notion = NotionDraftClient(os.environ.get("NOTION_TOKEN", ""))
        rebuild = RebuildClient(
            os.environ.get("AUTOMATION_TOKEN", ""),
            relay_url=os.environ.get("RELAY_URL", "") or None,
        )
    except (NotionDraftError, RebuildRequestError) as exc:
        print(f"자동 반영 설정 확인 필요: {exc}")
        return 1

    failed = approved = 0
    for job in todo:
        job_id = str(job["id"])
        try:
            if not notion.is_public(job):
                print("  · 아직 승인 전")
                continue
            store.mark_building(job_id)
            rebuild.request(str(job.get("company_slug") or ""))
            store.mark_complete(job_id)
            print(f"  → 재빌드 요청 완료: {job.get('company_name')}")
            approved += 1
        except Exception as exc:
            store.mark_failed(job_id, exc)
            print(f"  ! 실패: {type(exc).__name__}: {str(exc)[:200]}")
            failed += 1

    print(f"끝. 승인·반영 {approved}건, 승인 대기 {len(todo) - approved - failed}건, 실패 {failed}건.")
    return 1 if failed else 0


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    raise SystemExit(main())
