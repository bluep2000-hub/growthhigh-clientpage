#!/usr/bin/env python3
"""녹음 전사 → 회의록 → Notion 비공개 초안을 한 회차로 실행한다."""

from __future__ import annotations

import argparse
import io
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

from recording_jobs import PipelineAlreadyRunning, RecordingJobError, RecordingJobStore


ROOT = Path(__file__).resolve().parent.parent
STEPS = (
    ("전사", "transcribe_drive.py"),
    ("회의록", "summarize_recordings.py"),
    ("Notion 비공개 초안", "write_notion_drafts.py"),
    ("고객 공개 승인", "check_recording_approvals.py"),
)


def run_step(script: str, *, dry_run: bool, limit: int | None) -> int:
    command = [sys.executable, str(ROOT / "src" / script)]
    if dry_run:
        command.append("--dry-run")
    if limit is not None:
        command.extend(["--limit", str(limit)])
    return subprocess.run(command, cwd=ROOT, check=False).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="고객 통화녹음 처리 자동화")
    parser.add_argument("--dry-run", action="store_true",
                        help="전체 단계의 대상만 확인하고 외부 서비스를 건드리지 않는다")
    parser.add_argument("--limit", metavar="개수", type=int, default=None)
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    try:
        store = RecordingJobStore()
        lock = store.run_lock()
        if not args.dry_run:
            lock.acquire()
    except (PipelineAlreadyRunning, RecordingJobError) as exc:
        print(f"자동화 시작 보류: {exc}")
        return 0 if isinstance(exc, PipelineAlreadyRunning) else 1

    failures = 0
    try:
        for label, script in STEPS:
            print(f"\n[{label}]")
            if run_step(script, dry_run=args.dry_run, limit=args.limit) != 0:
                failures += 1
    finally:
        if not args.dry_run:
            lock.release()

    if failures:
        print(f"\n자동화 회차 종료: 확인이 필요한 단계 {failures}개")
        return 1
    print("\n자동화 회차 완료")
    return 0


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    raise SystemExit(main())
