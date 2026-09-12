#!/usr/bin/env python3
"""Windows 작업 스케줄러에서 통화녹음 자동화를 조용히 실행한다."""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PROCESS_SCRIPT = ROOT / "src" / "process_recordings.py"
LOG_MAX_BYTES = 2 * 1024 * 1024


def default_log_path() -> Path:
    override = os.environ.get("RECORDING_SCHEDULER_LOG", "").strip()
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA", "").strip()
    base = Path(local) if local else Path.home() / ".growthhigh"
    return base / "GrowthHigh" / "clientpage-automation" / "scheduler.log"


def console_python(executable: str | Path | None = None) -> Path:
    current = Path(executable or sys.executable)
    candidate = current.with_name("python.exe")
    return candidate if candidate.is_file() else current


def rotate_log(path: Path, *, max_bytes: int = LOG_MAX_BYTES) -> None:
    try:
        oversized = path.stat().st_size >= max_bytes
    except FileNotFoundError:
        return
    if oversized:
        os.replace(path, path.with_name(f"{path.name}.1"))


def run_once(*, log_path: Path | None = None,
             python_executable: str | Path | None = None) -> int:
    log_path = log_path or default_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    rotate_log(log_path)
    started_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with log_path.open("a", encoding="utf-8", newline="") as log:
        log.write(f"\n[{started_at}] 자동화 시작\n")
        log.flush()
        result = subprocess.run(
            [str(console_python(python_executable)), str(PROCESS_SCRIPT)],
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
        )
        finished_at = datetime.now().astimezone().isoformat(timespec="seconds")
        log.write(f"[{finished_at}] 자동화 종료 code={result.returncode}\n")
    return result.returncode


def main() -> int:
    return run_once()


if __name__ == "__main__":
    raise SystemExit(main())
