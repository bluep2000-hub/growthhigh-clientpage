"""통화녹음 자동화의 재개 가능한 로컬 처리 장부.

장부에는 음성이나 녹취 본문을 넣지 않는다. 고객사, 원본 상대경로, 처리 단계와
오류 요약만 기록한다. 기본 저장 위치는 웹으로 서빙되는 저장소 밖이다.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path


SCHEMA_VERSION = 1
STEP_VERSION = 1

STATES = {
    "received",
    "transcribing",
    "transcribed",
    "summarizing",
    "notion_writing",
    "building",
    "complete",
    "needs_review",
    "failed",
}


class RecordingJobError(RuntimeError):
    """처리 장부를 안전하게 읽거나 쓸 수 없다."""


class PipelineAlreadyRunning(RecordingJobError):
    """다른 자동화 회차가 아직 끝나지 않았다."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_jobs_path() -> Path:
    override = os.environ.get("RECORDING_JOBS_FILE", "").strip()
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA", "").strip()
    base = Path(local) if local else Path.home() / ".growthhigh"
    return base / "GrowthHigh" / "clientpage-automation" / "recording-jobs.json"


def _empty() -> dict:
    return {"schema_version": SCHEMA_VERSION, "jobs": {}}


def _safe_error_detail(detail: str) -> str:
    """화면용 장부에 긴 응답이나 여러 줄 본문이 들어가지 않게 한다."""
    return " ".join(str(detail).split())[:300]


class RecordingJobStore:
    def __init__(self, path: Path | None = None):
        self.path = path or default_jobs_path()

    def _read(self) -> dict:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return _empty()
        except (OSError, ValueError) as exc:
            raise RecordingJobError(
                f"처리 장부를 읽을 수 없다: {self.path}"
            ) from exc

        if (not isinstance(raw, dict)
                or raw.get("schema_version") != SCHEMA_VERSION
                or not isinstance(raw.get("jobs"), dict)):
            raise RecordingJobError(
                f"처리 장부 형식이 맞지 않는다: {self.path}"
            )
        return raw

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        try:
            temp.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(temp, self.path)
        except OSError as exc:
            temp.unlink(missing_ok=True)
            raise RecordingJobError(
                f"처리 장부를 저장할 수 없다: {self.path}"
            ) from exc

    def run_lock(self) -> "PipelineRunLock":
        return PipelineRunLock(self.path.with_suffix(".lock"))

    def all(self) -> list[dict]:
        return [dict(job) for job in self._read()["jobs"].values()]

    def get(self, job_id: str) -> dict | None:
        job = self._read()["jobs"].get(job_id)
        return dict(job) if job else None

    def transcript_stems(self) -> dict[str, str]:
        return {
            job_id: Path(job["transcript_name"]).stem
            for job_id, job in self._read()["jobs"].items()
            if job.get("transcript_name")
        }

    def ensure_received(
        self,
        *,
        job_id: str,
        source_relative_path: str,
        source_name: str,
        source_size: int,
        source_modified_at: str,
        company_name: str,
        company_slug: str,
        channel: str,
        occurred_at: str,
        transcript_name: str,
    ) -> dict:
        data = self._read()
        jobs = data["jobs"]
        now = utc_now()
        job = jobs.get(job_id)

        if job:
            if job.get("company_slug") != company_slug:
                raise RecordingJobError(
                    "같은 녹음이 다른 고객사 처리 장부에 이미 등록돼 있다"
                )
            job.update({
                "source_relative_path": source_relative_path,
                "source_name": source_name,
                "source_size": source_size,
                "source_modified_at": source_modified_at,
                "updated_at": now,
            })
        else:
            job = {
                "id": job_id,
                "source_relative_path": source_relative_path,
                "source_name": source_name,
                "source_size": source_size,
                "source_modified_at": source_modified_at,
                "received_at": now,
                "company_name": company_name,
                "company_slug": company_slug,
                "channel": channel,
                "occurred_at": occurred_at,
                "state": "received",
                "step_version": STEP_VERSION,
                "attempts": 0,
                "last_error_code": None,
                "last_error_detail": None,
                "transcript_name": transcript_name,
                "notion_page_id": None,
                "build_run_id": None,
                "created_at": now,
                "updated_at": now,
                "completed_at": None,
            }
            jobs[job_id] = job

        self._write(data)
        return dict(job)

    def mark_transcribing(self, job_id: str) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "transcribing"
        job["attempts"] = int(job.get("attempts") or 0) + 1
        job["last_error_code"] = None
        job["last_error_detail"] = None
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    def mark_transcribed(self, job_id: str) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "transcribed"
        job["last_error_code"] = None
        job["last_error_detail"] = None
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    def mark_summarizing(self, job_id: str) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "summarizing"
        job["last_error_code"] = None
        job["last_error_detail"] = None
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    def mark_notion_writing(self, job_id: str, summary_name: str) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "notion_writing"
        job["summary_name"] = summary_name
        job["last_error_code"] = None
        job["last_error_detail"] = None
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    def mark_needs_review(self, job_id: str, error: BaseException) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "needs_review"
        job["last_error_code"] = type(error).__name__
        job["last_error_detail"] = _safe_error_detail(str(error))
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    def mark_awaiting_approval(self, job_id: str, *, notion_page_id: str,
                               notion_url: str) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "needs_review"
        job["last_error_code"] = "WAITING_PUBLIC_APPROVAL"
        job["last_error_detail"] = (
            "Notion 초안의 내용과 기업명을 확인한 뒤 고객 공개를 체크하세요"
        )
        job["notion_page_id"] = notion_page_id
        job["notion_url"] = notion_url
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    def mark_building(self, job_id: str) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "building"
        job["last_error_code"] = None
        job["last_error_detail"] = None
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    def mark_complete(self, job_id: str) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        now = utc_now()
        job["state"] = "complete"
        job["last_error_code"] = None
        job["last_error_detail"] = None
        job["updated_at"] = now
        job["completed_at"] = now
        self._write(data)
        return dict(job)

    def mark_failed(self, job_id: str, error: BaseException) -> dict:
        data = self._read()
        job = self._required(data, job_id)
        job["state"] = "failed"
        job["last_error_code"] = type(error).__name__
        job["last_error_detail"] = _safe_error_detail(str(error))
        job["updated_at"] = utc_now()
        self._write(data)
        return dict(job)

    @staticmethod
    def _required(data: dict, job_id: str) -> dict:
        try:
            return data["jobs"][job_id]
        except KeyError as exc:
            raise RecordingJobError(f"처리 장부에 없는 녹음이다: {job_id}") from exc


class PipelineRunLock:
    """작업 스케줄러 회차가 겹치지 않게 하는 단일 실행 잠금."""

    STALE_AFTER_SECONDS = 6 * 60 * 60

    def __init__(self, path: Path):
        self.path = path
        self.token = secrets.token_hex(16)
        self.acquired = False

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError as exc:
                try:
                    age = time.time() - self.path.stat().st_mtime
                except FileNotFoundError:
                    continue
                if age <= self.STALE_AFTER_SECONDS:
                    raise PipelineAlreadyRunning(
                        "다른 녹음 자동화 회차가 아직 실행 중이다"
                    ) from exc
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                continue
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({
                    "pid": os.getpid(),
                    "created_at": utc_now(),
                    "token": self.token,
                }, handle)
            self.acquired = True
            return
        raise PipelineAlreadyRunning("녹음 자동화 잠금을 얻지 못했다")

    def release(self) -> None:
        if not self.acquired:
            return
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if value.get("token") == self.token:
                self.path.unlink(missing_ok=True)
        except (FileNotFoundError, OSError, ValueError):
            pass
        self.acquired = False

    def __enter__(self) -> "PipelineRunLock":
        self.acquire()
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.release()
