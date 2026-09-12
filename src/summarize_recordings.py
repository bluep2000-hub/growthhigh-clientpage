#!/usr/bin/env python3
"""전사 완료 작업을 검증된 회의록 초안 파일로 만든다.

초안 파일은 처리 장부 옆의 비공개 로컬 폴더에 둔다. 다음 단계의 Notion 기록이
성공하기 전까지 보존해, 중간에 프로그램이 끝나도 Gemini 요약부터 반복하지 않는다.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from google import genai

from recording_jobs import RecordingJobError, RecordingJobStore
from summarize_transcript import (
    DEFAULT_MODEL,
    MeetingSummary,
    SummaryNeedsReview,
    summarize,
    validate_summary,
)
from transcribe_drive import TALKS_DIR


ROOT = Path(__file__).resolve().parent.parent


def drafts_dir(store: RecordingJobStore) -> Path:
    override = os.environ.get("RECORDING_DRAFTS_DIR", "").strip()
    return Path(override) if override else store.path.parent / "summary-drafts"


def draft_path(store: RecordingJobStore, job_id: str) -> Path:
    return drafts_dir(store) / f"{job_id}.json"


def write_summary(path: Path, summary: MeetingSummary) -> None:
    summary = validate_summary(summary.title, summary.minutes_markdown)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temp.write_text(json.dumps({
            "title": summary.title,
            "minutes_markdown": summary.minutes_markdown,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def read_summary(path: Path) -> MeetingSummary:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return validate_summary(
            payload["title"],
            payload["minutes_markdown"],
        )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        if isinstance(exc, SummaryNeedsReview):
            raise
        raise SummaryNeedsReview("저장된 회의록 초안 형식을 읽을 수 없다") from exc


def safe_transcript_path(folder: Path, job: dict) -> Path:
    name = str(job.get("transcript_name") or "")
    if not name or Path(name).name != name:
        raise SummaryNeedsReview("전사본 파일 이름이 올바르지 않다")
    path = folder / name
    if not path.is_file():
        raise SummaryNeedsReview(f"전사본을 찾을 수 없다: {name}")
    return path


def pending_jobs(store: RecordingJobStore) -> list[dict]:
    return sorted(
        (job for job in store.all()
         if job.get("state") in {"transcribed", "summarizing"}),
        key=lambda job: (job.get("received_at") or "", job.get("id") or ""),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="전사본 회의록 초안 생성기")
    parser.add_argument("--dry-run", action="store_true",
                        help="대상만 보여 주고 Gemini와 파일을 건드리지 않는다")
    parser.add_argument("--limit", metavar="개수", type=int, default=None)
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    folder = Path(os.environ.get("TALKS_DIR") or TALKS_DIR)
    if not folder.is_dir():
        sys.exit(f"폴더를 못 찾았다: {folder}")

    try:
        store = RecordingJobStore()
        todo = pending_jobs(store)
    except RecordingJobError as exc:
        print(f"처리 장부 확인 필요:\n{exc}")
        return 1

    if args.limit:
        todo = todo[:args.limit]
    if not todo:
        print("회의록으로 만들 새 전사본이 없다.")
        return 0

    print(f"회의록 초안 대상 {len(todo)}건")
    for job in todo:
        print(f"  {job.get('transcript_name')} → {job.get('company_name')}")
    if args.dry_run:
        print("dry-run 이라 여기서 멈춘다.")
        return 0

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        sys.exit("GEMINI_API_KEY 가 없다. .env 를 확인해라.")
    model = (os.environ.get("GEMINI_SUMMARY_MODEL")
             or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL)
    client = genai.Client(api_key=api_key)

    failed = 0
    for job in todo:
        job_id = str(job["id"])
        output = draft_path(store, job_id)
        try:
            transcript_path = safe_transcript_path(folder, job)
            if output.is_file():
                summary = read_summary(output)
            else:
                store.mark_summarizing(job_id)
                transcript = transcript_path.read_text(encoding="utf-8")
                summary = summarize(
                    client,
                    model=model,
                    transcript=transcript,
                    company=str(job.get("company_name") or ""),
                    occurred_at=str(job.get("occurred_at") or ""),
                    channel=str(job.get("channel") or "통화"),
                )
                write_summary(output, summary)
            store.mark_notion_writing(job_id, output.name)
            print(f"  → {summary.title}")
        except SummaryNeedsReview as exc:
            store.mark_needs_review(job_id, exc)
            print(f"  ! 확인 필요: {exc}")
            failed += 1
        except Exception as exc:
            store.mark_failed(job_id, exc)
            print(f"  ! 실패: {type(exc).__name__}: {str(exc)[:200]}")
            failed += 1

    print(f"끝. 성공 {len(todo) - failed}건, 확인 필요·실패 {failed}건.")
    return 1 if failed else 0


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    raise SystemExit(main())
