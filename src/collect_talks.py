#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
클로바노트에서 내려받은 녹취 txt 를 드라이브 폴더로 옮긴다.

클로바노트는 API 도 자동 내보내기도 없어서, 사람이 웹에서 텍스트를 내려받는다.
내려받기만 하면 그다음은 이 스크립트가 맡는다 — 이름을 다듬고 제자리에 놓는다.
파일이 놓이면 talk-summary 가 읽어 노션에 기록한다.

    python src/collect_talks.py --dry-run
    python src/collect_talks.py

폴더는 .env 의 DOWNLOADS_DIR·TALKS_DIR 로 덮어쓸 수 있다.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent

DOWNLOADS_DIR = Path.home() / "Downloads"

# 구글 드라이브 데스크톱이 「클라이언트 통화 미팅기록」 을 붙이는 자리.
# 공유 폴더라 내 드라이브 밑이 아니라 바로가기 대상 경로로 잡힌다.
TALKS_DIR = (r"G:\.shortcut-targets-by-id"
             r"\1EV3Ss6vvv5PUjcR9GtXXGWK36xeTE-I8\클라이언트 통화 미팅기록")

CHANNELS = {"통화", "미팅"}


def norm_stem(name: str) -> str | None:
    """파일명을 YYMMDD_기업명_채널 로 정규화한다.

    밑줄 앞뒤 공백과 겹친 공백, 클로바노트가 붙이는 (1) 같은 꼬리를 걷어낸다.
    형식이 안 맞으면 None 을 준다. 넘겨짚지 않는다.
    """
    stem = re.sub(r"\s*\(\d+\)$", "", Path(name).stem)
    parts = [p.strip() for p in stem.split("_")]
    if len(parts) != 3:
        return None
    day, company, channel = (re.sub(r"\s+", " ", p) for p in parts)
    if not re.fullmatch(r"\d{6}", day):
        return None
    if channel not in CHANNELS or not company:
        return None
    return f"{day}_{company}_{channel}"


def main() -> int:
    ap = argparse.ArgumentParser(description="녹취 txt 수집기")
    ap.add_argument("--dry-run", action="store_true",
                    help="옮길 파일만 보여 주고 실제로 건드리지 않는다")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    src = Path(os.environ.get("DOWNLOADS_DIR") or DOWNLOADS_DIR)
    dst = Path(os.environ.get("TALKS_DIR") or TALKS_DIR)

    if not src.is_dir():
        sys.exit(f"다운로드 폴더를 못 찾았다: {src}")
    if not dst.is_dir():
        sys.exit(f"드라이브 폴더를 못 찾았다: {dst}\n"
                 "구글 드라이브 데스크톱이 켜져 있는지 확인해라.")

    moved = skipped = 0
    for p in sorted(src.glob("*.txt")):
        stem = norm_stem(p.name)
        if stem is None:
            continue  # 우리 것이 아닌 txt 는 조용히 둔다
        target = dst / f"{stem}.txt"
        if target.exists():
            print(f"이미 있다. 그대로 둔다: {stem}.txt")
            skipped += 1
            continue
        print(f"{p.name} → {target.name}")
        if not args.dry_run:
            shutil.move(str(p), str(target))
        moved += 1

    if args.dry_run:
        print(f"dry-run: 옮길 것 {moved}건, 건너뛸 것 {skipped}건.")
    else:
        print(f"끝. 옮김 {moved}건, 건너뜀 {skipped}건.")
    return 0


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    raise SystemExit(main())
