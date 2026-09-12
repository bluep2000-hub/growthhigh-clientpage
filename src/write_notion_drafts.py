#!/usr/bin/env python3
"""검증된 회의록을 커뮤니케이션보드의 비공개 초안으로 기록한다."""

from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from notion_talk_drafts import NotionDraftClient, NotionDraftError
from recording_jobs import RecordingJobError, RecordingJobStore
from summarize_recordings import draft_path, read_summary


ROOT = Path(__file__).resolve().parent.parent


def pending_jobs(store: RecordingJobStore) -> list[dict]:
    return sorted(
        (job for job in store.all() if job.get("state") == "notion_writing"),
        key=lambda job: (job.get("received_at") or "", job.get("id") or ""),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Notion 회의록 비공개 초안 기록기")
    parser.add_argument("--dry-run", action="store_true",
                        help="대상만 보여 주고 Notion을 건드리지 않는다")
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
        print("Notion에 기록할 새 회의록 초안이 없다.")
        return 0

    print(f"Notion 비공개 초안 대상 {len(todo)}건")
    for job in todo:
        print(f"  {job.get('company_name')} · {job.get('occurred_at')}")
    if args.dry_run:
        print("dry-run 이라 여기서 멈춘다.")
        return 0

    try:
        client = NotionDraftClient(os.environ.get("NOTION_TOKEN", ""))
    except NotionDraftError as exc:
        print(f"Notion 연결 확인 필요: {exc}")
        return 1

    failed = 0
    for job in todo:
        job_id = str(job["id"])
        try:
            summary = read_summary(draft_path(store, job_id))
            draft = client.create_or_get(job, summary)
            store.mark_awaiting_approval(
                job_id,
                notion_page_id=draft.page_id,
                notion_url=draft.url,
            )
            result = "새 초안" if draft.created else "기존 초안 확인"
            print(f"  → {result}: {summary.title}")
        except Exception as exc:
            store.mark_failed(job_id, exc)
            print(f"  ! 실패: {type(exc).__name__}: {str(exc)[:200]}")
            failed += 1

    print(f"끝. 성공 {len(todo) - failed}건, 실패 {failed}건.")
    return 1 if failed else 0


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    raise SystemExit(main())
