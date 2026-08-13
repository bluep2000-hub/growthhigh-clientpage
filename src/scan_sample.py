"""`c/sample.json` 전문을 훑어 공개하면 안 되는 것이 남았는지 본다.

배포 전에 반드시 한 번 돌린다. 손으로 고쳤든 스크립트로 만들었든 상관없이
결과물만 본다 — 어떻게 만들었는지는 묻지 않는다.

    python src/scan_sample.py
    python src/scan_sample.py --json    # 결과를 JSON 으로

종료 코드 0 이면 걸린 것이 없다. 1 이면 있다 — 그대로 push 하지 말 것.

이 목록은 실제로 한 번씩 새어 나왔던 것들이다. 줄이지 말고 늘려서 쓸 것.
  · 정부지원 시스템 계정 ID/PW (판판대로·IRIS·K-Startup·중진공·SBA)
  · 대표 자택 주소, 법인 소재지
  · 자사 채용공고 URL (사람인·잡코리아) — 열면 실기업이 나온다
  · FDA Product Listing·특허 등록번호 — 공개 등록부에서 되짚을 수 있다
  · 공용 메일의 개인 계정 (로컬파트에 사명·실명이 든 것)
  · 메일 서명 블록과 그 뒤의 인용 헤더
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_sample as M                                    # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# 걸리면 안 되는 것. (라벨, 정규식) — 하나라도 걸리면 실패다.
CHECKS: list[tuple[str, str]] = [
    ("원본 기업명·브랜드", "|".join(re.escape(w) for w in M.FORBIDDEN)),
    ("비밀번호 값", r"(?i)(?:pw|password|비밀번호|비번)\s*[:：]\s*(?!●)\S{2,}"),
    ("계정 ID 값", r"(?i)(?:\bID\b|아이디)\s*[:：]\s*(?!●)\S{2,}"),
    ("주민등록번호", r"\d{6}\s*[-–]\s*[1-4]\d{6}"),
    ("법인등록번호", r"\d{6}\s*[-–]\s*\d{7}"),
    ("카드번호", r"(?:\d{4}[-\s]?){3}\d{4}"),
    ("여권번호", r"\b[MSRODmsrod]\d{8}\b"),
    ("계좌번호", r"(?<!\d)\d{2,3}-\d{2,6}-\d{5,6}(?!\d)"),
    ("사업자등록번호", r"(?<!\d)\d{3}-?\d{2}-?\d{5}(?!\d)"),
    ("10자리 숫자", r"(?<![\d,.])\d{10}(?![\d,.])"),
    ("특허 등록번호", r"제\s*10-\d{6,8}\s*호"),
    ("전화번호", r"(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"),
    ("도로명주소", r"[가-힣]{2,6}(?:대로|로|길)\s?\d+[길]?\s*[\d-]+"),
    ("우편번호", r"\(우[\s:]*\d{5}\)"),
    ("자사 채용공고", r"saramin\.co\.kr/zf_user|jobkorea\.co\.kr"),
    ("구글드라이브 링크", r"(?:drive|docs)\.google\.com"),
    ("서명 블록 잔재",
     r"Time Saving|Republic of Korea|Operations Support|HR&GA"),
    ("인용 헤더", r"(?m)^\s*(?:From|To|Cc|Subject|보낸사람|받는사람)\s*:"),
]

# 남아 있어도 되는 것. 세어서 보여주기만 한다.
NOTES: list[tuple[str, str]] = [
    ("그로스하이 실명(유지)", "|".join(re.escape(w) for w in M.KEEP_PEOPLE)),
    ("메일 도메인", r"@([\w.-]+\.\w{2,})"),
    ("외부 URL", r"https?://([\w.-]+)"),
]


def allowed_links(data: dict) -> list[str]:
    """좌측 「자료」에 일부러 걸어 둔 링크. 검사에서 뺀다."""
    co = data.get("company") or {}
    out = [co.get(k) for k in ("drive_url", "bizplan_url", "guidebook_url")]
    for g in co.get("extra_links") or []:
        out += [i.get("url") for i in (g.get("items") or [])]
    return [u for u in out if u]


def leftover_people(blob: str) -> list[tuple[str, int]]:
    """성씨로 시작하는 세 글자 토큰 중 유지 대상이 아닌 것. 오탐이 많아 참고용이다."""
    text = re.sub(r"<[^>]+>", " ", blob)
    keep = set(M.KEEP_PEOPLE)
    masked = set(M.PEOPLE)
    hits = Counter(w for w in re.findall(r"[가-힣]{3}", text)
                   if w[0] in "김이박최정강조윤장임한오서신권황안송류전홍고문양"
                              "손배백허유남심노하곽성차주우구원"
                   and w not in keep and w not in masked)
    return hits.most_common(20)


def main() -> int:
    ap = argparse.ArgumentParser(description="샘플 데이터 전수 스캔")
    ap.add_argument("--json", action="store_true", help="결과를 JSON 으로 낸다")
    ap.add_argument("--file", default=None, help="검사할 파일 (기본 c/{샘플}.json)")
    args = ap.parse_args()

    path = Path(args.file) if args.file else ROOT / "c" / f"{M.SAMPLE_SLUG}.json"
    if not path.exists():
        print(f"파일이 없습니다: {path}")
        return 2
    blob = path.read_text(encoding="utf-8")
    data = json.loads(blob).get("data", {})

    # 일부러 걸어 둔 자료 링크는 빼고 본다. 그것까지 걸리면 매번 오탐이 난다.
    allow = allowed_links(data)
    scan = blob
    for url in allow:
        scan = scan.replace(json.dumps(url, ensure_ascii=False)[1:-1], "")

    result, bad = {}, 0
    for label, pat in CHECKS:
        hits = re.findall(pat, scan, re.I)
        flat = [h if isinstance(h, str) else "".join(h) for h in hits]
        result[label] = Counter(flat)
        bad += len(flat)

    if args.json:
        print(json.dumps({k: dict(v) for k, v in result.items()},
                         ensure_ascii=False, indent=2))
        return 1 if bad else 0

    print(f"검사 대상 {path}  {len(blob.encode('utf-8')):,}B")
    if allow:
        print(f"검사에서 뺀 자료 링크 {len(allow)}개")
        for u in allow:
            print(f"    {u[:88]}")
    print("=" * 68)
    for label, _ in CHECKS:
        c = result[label]
        n = sum(c.values())
        print(f"{label:18} {n:>5}건" + ("   ★ 확인" if n else ""))
        for v, k in c.most_common(6):
            print(f"      {k:>4}x {v[:72]}")
    print("=" * 68)
    print(f"확인 필요 {bad}건\n")

    for label, pat in NOTES:
        c = Counter(re.findall(pat, blob, re.I))
        print(f"[{label}] {sum(c.values())}건")
        for v, k in c.most_common(8):
            print(f"    {k:>4}x {v[:60]}")

    ppl = leftover_people(blob)
    if ppl:
        print("\n[이름 후보 — 오탐 많음, 눈으로 확인] " +
              ", ".join(f"{w}({n})" for w, n in ppl[:12]))

    talks = data.get("talks") or []
    print(f"\n[구조] progress {len(data.get('progress') or [])} · "
          f"talks {len(talks)} · events {len(data.get('events') or [])} · "
          f"recommend {len(data.get('recommend') or [])} · "
          f"notice {len((data.get('notice') or {}).get('sections') or [])}섹션")
    print(f"       채널 {dict(Counter(t.get('channel') for t in talks))}")
    gone = M.missing_assets(blob)
    print(f"       가리키는데 없는 파일: {gone or '없음'}")
    if gone:
        bad += len(gone)

    print("\n" + ("★ 걸린 것이 있습니다 — push 하지 마세요."
                  if bad else "깨끗합니다."))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
