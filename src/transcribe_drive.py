#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
통화·미팅 녹음본 전사기.

구글드라이브 「클라이언트 통화 미팅기록」 폴더에서 오디오 파일을 찾아
Gemini 로 받아쓴 뒤 같은 폴더에 YYMMDD_기업명_채널.txt 로 떨군다.
요약은 하지 않는다 — 그건 talk-summary 스킬이 노션에 기록한다.

파일 이름은 손보지 않아도 된다. 녹음기가 붙인 이름에서 알아낼 수 있는 만큼
알아내고, 못 알아낸 고객사는 talk-summary 가 본문을 읽고 정한다.

폴더는 구글 드라이브 데스크톱이 붙여 주는 로컬 경로로 읽는다.
서비스 계정은 파일을 소유할 수 없어 API 로는 쓰기가 막히고,
drive 권한은 제한된 범위라 OAuth 도 유료 심사를 요구한다.

    python src/transcribe_drive.py --dry-run
    python src/transcribe_drive.py

키는 .env 의 GEMINI_API_KEY 에서 읽는다.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import time
import tempfile
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parent.parent

# 구글 드라이브 데스크톱이 「클라이언트 통화 미팅기록」 을 붙이는 자리.
# 공유 폴더라 내 드라이브 밑이 아니라 바로가기 대상 경로로 잡힌다.
# .env 의 TALKS_DIR 로 덮어쓸 수 있다.
TALKS_DIR = (r"G:\.shortcut-targets-by-id"
             r"\1EV3Ss6vvv5PUjcR9GtXXGWK36xeTE-I8\클라이언트 통화 미팅기록")

# 어떤 오디오를 이미 받아썼는지 적어 둔다. 중간에 끊겨도 이어서 간다.
LEDGER = ROOT / ".transcribed.json"

# 전사 전용 모델(gemini-3.5-transcribe)은 화자를 나누지 않고 프롬프트를 무시한다.
# 범용 모델이 화자 구분·고유명사 교정 모두 낫고 오디오 길이 여유도 크다.
DEFAULT_MODEL = "gemini-3.8-flash"

AUDIO_EXTS = {".m4a", ".mp3", ".wav", ".aac", ".amr", ".ogg", ".opus",
              ".flac", ".3gp", ".mp4", ".m4v", ".mov", ".webm"}

# 들릴 만한 고유명사를 미리 일러 주면 받아쓰기 정확도가 눈에 띄게 오른다.
# 고객사 이름은 여기 넣지 않는다 — 파일명에서 알아낸 그 회사만 덧붙인다.
# 목록으로 주면 대화에 없는 회사 이름을 끌어다 쓰는 일이 생긴다.
GLOSSARY = ["그로스하이", "박재현", "소공인 판로개척", "초기창업패키지"]

CHANNEL_WORDS = {"통화": "통화", "미팅": "미팅", "회의": "미팅"}


def parse_name(name: str) -> tuple[str | None, str | None, str | None]:
    """녹음 파일 이름에서 날짜·고객사·채널을 뽑는다. 못 뽑은 자리는 None.

    두 가지 이름을 안다.
        260831_위프코리아_통화.m4a                          사람이 직접 붙인 이름
        통화 녹음 [위프코리아]이상윤 차장님_260831_174908.m4a  녹음기가 붙인 이름

    둘 다 아니면 알아낸 것만 돌려준다. 못 알아낸 자리는 넘겨짚지 않는다.
    고객사를 몰라도 전사는 한다 — 누구인지는 talk-summary 가 본문을 읽고 정한다.
    """
    stem = re.sub(r"\s*\(\d+\)$", "", Path(name).stem)

    parts = [re.sub(r"\s+", " ", p.strip()) for p in stem.split("_")]
    if (len(parts) == 3 and re.fullmatch(r"\d{6}", parts[0])
            and parts[1] and parts[2] in CHANNEL_WORDS):
        return parts[0], parts[1], CHANNEL_WORDS[parts[2]]

    day = None
    m = re.search(r"_(\d{6})_\d{6}$", stem)   # 녹음기가 끝에 날짜_시각을 붙인다
    if m:
        day, stem = m.group(1), stem[:m.start()]

    m = re.search(r"\[([^\]]+)\]", stem)      # 제목의 [고객사]
    company = m.group(1).strip() if m and m.group(1).strip() else None

    channel = next((v for k, v in CHANNEL_WORDS.items() if k in stem), None)
    return day, company, channel


def load_ledger() -> dict[str, str]:
    try:
        return json.loads(LEDGER.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def prompt_for(company: str | None) -> str:
    words = ", ".join(GLOSSARY + ([company] if company else []))
    return f"""이 오디오는 경영 컨설턴트와 고객사 담당자의 한국어 통화 또는 미팅 녹음입니다.
들리는 그대로 받아쓰세요.

이 대화에 나올 수 있는 고유명사: {words}

규칙:
- 화자가 바뀔 때마다 「화자1:」 「화자2:」 처럼 줄을 나눈다. 이름을 알 수 있으면 이름을 쓴다.
- 요약·해석·의견을 덧붙이지 않는다. 발화만 옮긴다.
- 숫자·금액·사업명·기관명은 들린 그대로 정확히 쓴다.
- 안 들리는 구간은 [잘 안 들림] 으로 표시한다.
- 인사말이나 잡담도 빼지 않는다."""


def transcribe(client: genai.Client, model: str, path: Path,
               company: str | None) -> str:
    # 업로드는 파일명을 아스키로만 다뤄서 한글 이름이면 깨진다. 옮겨 담아 올린다.
    with tempfile.NamedTemporaryFile(suffix=path.suffix, delete=False) as fh:
        stage = Path(fh.name)
    shutil.copyfile(path, stage)
    try:
        up = client.files.upload(file=stage)
    finally:
        stage.unlink(missing_ok=True)
    try:
        # 모델이 붐빌 때 503 이 곧잘 뜬다. 무인 실행이라 몇 번 기다려 준다.
        for wait in (10, 30, 60, None):
            try:
                resp = client.models.generate_content(
                    model=model,
                    contents=[prompt_for(company), up],
                    config=types.GenerateContentConfig(temperature=0),
                )
                break
            except Exception as e:
                if wait is None or "503" not in str(e):
                    raise
                print(f"    모델이 붐빈다. {wait}초 뒤 다시 시도한다", flush=True)
                time.sleep(wait)
        if resp.candidates and resp.candidates[0].finish_reason == "MAX_TOKENS":
            print("    ! 출력 한도에 걸려 뒷부분이 잘렸다", flush=True)
        return (resp.text or "").strip()
    finally:
        try:
            client.files.delete(name=up.name)
        except Exception:
            pass


def main() -> int:
    ap = argparse.ArgumentParser(description="녹음본 전사기")
    ap.add_argument("--dry-run", action="store_true",
                    help="전사 대상만 보여 주고 Gemini 도 폴더도 건드리지 않는다")
    ap.add_argument("--limit", metavar="개수", type=int, default=None,
                    help="이번 회차에 처리할 최대 개수")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    folder = Path(os.environ.get("TALKS_DIR") or TALKS_DIR)
    model = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL

    if not folder.is_dir():
        sys.exit(f"폴더를 못 찾았다: {folder}\n"
                 "구글 드라이브 데스크톱이 켜져 있는지 확인해라.")

    ledger = load_ledger()
    taken = {p.stem for p in folder.glob("*.txt")}

    todo = []
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in AUDIO_EXTS or p.name in ledger:
            continue
        day, company, channel = parse_name(p.name)
        base = "_".join([
            day or datetime.fromtimestamp(p.stat().st_mtime).strftime("%y%m%d"),
            company or "미분류",
            channel or "녹음",
        ])
        stem, n = base, 2               # 같은 날 같은 곳과 두 번 통화할 수 있다
        while stem in taken:
            stem, n = f"{base}_{n}", n + 1
        taken.add(stem)
        todo.append((p, stem, company))

    if not todo:
        print("전사할 새 녹음본이 없다.")
        return 0

    if args.limit:
        todo = todo[:args.limit]

    print(f"전사 대상 {len(todo)}건 (모델 {model})")
    for p, stem, company in todo:
        mark = "" if company else "   ← 고객사 미상. 요약할 때 본문 보고 정한다"
        size = p.stat().st_size / 1048576
        print(f"  {p.name}\n    → {stem}.txt  ({size:.1f}MB){mark}")

    if args.dry_run:
        print("dry-run 이라 여기서 멈춘다.")
        return 0

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("GEMINI_API_KEY 가 없다. .env 에 넣어라.")
    client = genai.Client(api_key=api_key)

    fails = 0
    for p, stem, company in todo:
        print(f"\n{p.name}", flush=True)
        try:
            text = transcribe(client, model, p, company)
            if not text:
                print("    ! 전사 결과가 비었다. 건너뛴다.")
                fails += 1
                continue
            (folder / f"{stem}.txt").write_text(text, encoding="utf-8")
            ledger[p.name] = stem      # 한 건 끝날 때마다 적는다. 끊겨도 이어 간다
            LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=2),
                              encoding="utf-8")
            print(f"    → {stem}.txt ({len(text):,}자)")
        except Exception as e:
            print(f"    ! 실패: {type(e).__name__}: {str(e)[:200]}")
            fails += 1

    print(f"\n끝. 성공 {len(todo) - fails}건, 실패 {fails}건.")
    return 1 if fails else 0


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    raise SystemExit(main())
