"""다른 클라이언트의 프로젝트·메일·미팅을 `c/sample.json` 에 합친다.

샘플 한 곳만으로는 화면이 성기다. 두 번째 클라이언트를 같은 가명으로
덮어 합치면 분량이 붙는다. 원본과 노션은 건드리지 않는다 — 읽기만 한다.

    python src/merge_sample.py --company 더모멘트 --dry-run
    python src/merge_sample.py --company 더모멘트

가져오는 것은 셋이다.
    프로젝트   기업 DB 의 「고객사 정보」 릴레이션으로 찾는다
    메일       IMAP 폴더 Inbox.고객사.{기업명} 에서 직접 읽는다 (노션을 거치지 않는다)
    미팅·유선   노션 소통 내역 DB 에서 「보류」가 아닌 것

마스킹은 make_sample.py 의 규칙을 그대로 쓰고, 아래 MERGE_SOURCES 에
클라이언트별 표기(사명·브랜드·도메인·인명)를 더한다.
"""
from __future__ import annotations

import argparse
import imaplib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_client as B                                   # noqa: E402
import make_sample as M                                    # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# ══════════════════════════════════════════════════════════════════════════
# 설정 — 합칠 클라이언트를 여기에 적는다
# ══════════════════════════════════════════════════════════════════════════
#
#   names/brands/domains  원본 표기 → 샘플 표기로 바꾼다 (긴 것부터)
#   accounts              공용 메일의 개인 계정. 로컬파트에 사명이 들어가면 남는다
#   people                클라이언트 측 실명 → 마스킹
#   projects              가져올 프로젝트명. 비우면 전부
#   exclude_title         이 정규식에 걸리는 제목의 메일은 빼고 가져온다
#
MERGE_SOURCES: dict[str, dict] = {
    # 원본 자신을 다시 읽는 경우다. c/{원본}.enc 의 talks 는 TALKS_OUTPUT_MAX(100)
    # 에서 잘려 있어, 폴더에 있는 205통을 다 담으려면 IMAP 을 직접 읽어야 한다.
    # 표기·인명·주소 규칙은 make_sample.py 설정 블록이 이미 갖고 있으므로 비운다.
    # 프로젝트는 이미 들어가 있다 — 반드시 --talks-only 로 돌릴 것.
    "스튜디오엘비": {
        "names": [], "brands": [], "domains": [], "accounts": {},
        "people": {}, "address": [],
        "projects": [],
        "exclude_title": "",
        "talks_days": 0,          # 0 = 기간 제한 없이 메일함 전부
    },
    "더모멘트": {
        "names": ["주식회사 더모멘트", "주식회사더모멘트", "(주)더모멘트", "더모멘트"],
        "brands": ["디퍼앤디퍼", "THEMOMENT", "Themoment", "themoment"],
        "domains": ["themomentgroup.co.kr"],
        "accounts": {
            "themoment20@naver.com": "kcos20@naver.com",
            "bestsohn77": "user77",
            "anhj24": "user24",
        },
        "people": {"안현주": "안○○", "안지현": "안○○",
                   "조동균": "조○○", "김지현": "김○○"},
        "address": [(r"[가-힣]{2,6}순환로\s*\d+", "○○로 ○○"), (r"구리시", "○○시"),
                    (r"\bB동\s*\d+-\d+호", "○동 ○○호")],
        "projects": [
            "2026년 생활문화 혁신지원사업",
            "2026년 소상공인 도약 지원사업",
            "2026년 창업중심대학",
            "2026년 상반기 중소기업기술혁신개발사업(수출지향형)",
            "사업주 직업능력개발훈련",
            "IR 참고자료 조사",
        ],
        "exclude_title": "",          # 겹치는 사업이 있으면 여기에 정규식을 적는다
        "talks_days": 0,              # 0 = 기간 제한 없이 메일함 전부
    },
}


def apply_source_rules(cfg: dict) -> None:
    """make_sample 의 규칙 앞에 이 클라이언트 전용 규칙을 끼워 넣는다."""
    rules = []
    for acc, new in (cfg.get("accounts") or {}).items():
        rules.append((acc, new))
    for dom in cfg.get("domains") or []:
        rules.append((dom, M.NEW_DOMAIN))
        rules.append((dom.split(".")[0], M.NEW_EN.lower()))
    for name in cfg.get("names") or []:
        rules.append((name, name.replace(cfg["names"][-1], M.NEW_NAME)
                      if cfg["names"][-1] in name else M.NEW_NAME))
    for brand in cfg.get("brands") or []:
        if brand.isupper():
            rules.append((brand, M.NEW_EN.upper()))
        elif brand.isascii():
            rules.append((brand, M.NEW_EN.capitalize()
                          if brand[0].isupper() else M.NEW_EN.lower()))
        else:
            rules.append((brand, M.NEW_NAME))
    M.RULES[:0] = rules

    M.MASK_RULES[:0] = [
        ("사람이름", re.compile(r"\s*".join(re.escape(c) for c in name)), masked)
        for name, masked in (cfg.get("people") or {}).items()
        if name not in M.KEEP_PEOPLE
    ] + [("주소", re.compile(p, re.I), n) for p, n in (cfg.get("address") or [])]


# ══════════════════════════════════════════════════════════════════════════
# 수집
# ══════════════════════════════════════════════════════════════════════════

def find_company(nt: B.Notion, name: str) -> str:
    """기업 DB 에서 기업명으로 찾는다. 빈 껍데기 행이 섞여 있어 내용이 있는 쪽을 쓴다."""
    res = nt.post(f"/databases/{B.COMPANY_DB_ID}/query",
                  {"filter": {"property": "기업명", "title": {"equals": name}},
                   "page_size": 10})
    rows = res.get("results", [])
    if not rows:
        raise SystemExit(f"기업 DB 에서 {name!r} 을 찾지 못했습니다.")
    with_body = [r for r in rows if B.p_text(r["properties"], "사업내용")]
    if len(rows) > 1:
        print(f"  ⚠ 기업 DB 에 {name!r} 행이 {len(rows)}개 — 내용이 있는 행을 씁니다")
    return (with_body or rows)[0]["id"]


def find_client_page(nt: B.Notion, name: str) -> str | None:
    """공유페이지 DB 에서 이 기업의 클라이언트 행을 찾는다. 소통 DB 조회에 쓴다."""
    rows = nt.query_all(B.SHARE_DB_ID, {
        "filter": {"property": "페이지 유형",
                   "multi_select": {"contains": B.CLIENT_PAGE_TYPE}}})
    for r in rows:
        if name in B.p_text(r.get("properties", {}), "페이지명"):
            return r["id"]
    return None


def fetch_projects(nt: B.Notion, company_id: str, wanted: list[str]) -> list[dict]:
    rows = B.fetch_projects(nt, company_id)
    if not wanted:
        return rows
    picked = [r for r in rows if r["title"] in wanted]
    missing = [w for w in wanted if w not in {r["title"] for r in picked}]
    if missing:
        print(f"  ⚠ 프로젝트를 못 찾음: {missing}")
    return picked


def fetch_mails(name: str, days: int, exclude: str) -> list[dict]:
    """고객사 폴더에서 직접 읽는다. 노션 소통 DB 를 거치지 않는다."""
    host, user, pw = (os.environ.get(k, "") for k in
                      ("IMAP_HOST", "IMAP_USER", "IMAP_PASS"))
    if not (host and user and pw):
        print("  ⚠ IMAP 접속 정보가 없어 메일을 건너뜁니다")
        return []
    M_ = imaplib.IMAP4_SSL(host, B.IMAP_PORT, timeout=60)
    try:
        M_.login(user, pw)
        typ, data = M_.list()
        target = B.nfc(B.TALKS_FOLDER_PREFIX + name)
        folder = next((raw for raw in (B.list_raw_name(x) for x in data or [])
                       if raw and B.nfc(B.imap_utf7_decode(raw)) == target), None)
        if folder is None:
            print(f"  ⚠ 메일 폴더 없음: {target}")
            return []
        mails, exists = B.scan_folder(M_, folder, days)
        print(f"  메일 폴더 {exists}통 · 기간 안 {len(mails)}건")
        B.read_bodies(M_, mails)
    finally:
        for close in (M_.close, M_.logout):
            try:
                close()
            except Exception:                              # noqa: BLE001
                pass

    if exclude:
        rx = re.compile(exclude)
        dropped = [m for m in mails if rx.search(m["title"])]
        mails = [m for m in mails if not rx.search(m["title"])]
        for m in dropped:
            print(f"    제외 {m['date']} {m['direction']} {m['title'][:52]}")
    return [{"date": m["date"], "channel": B.TALK_CHANNEL_MAIL, "title": m["title"],
             "preview": (m.get("body") or "") or None,
             "body": (m.get("body") or "") or None,
             "body_html": None, "direction": m["direction"]} for m in mails]


def fetch_meetings(nt: B.Notion, client_page: str) -> list[dict]:
    """노션 소통 DB 의 미팅·유선. 회의록은 페이지 본문에 있다."""
    rows = nt.query_all(B.TALKS_DB_ID, {
        "filter": {"property": "클라이언트", "relation": {"contains": client_page}}})
    out = []
    for pg in rows:
        pr = pg.get("properties", {})
        channel = B.p_select(pr, "채널") or ""
        if channel not in B.TALK_CHANNELS_WITH_MINUTES:
            continue
        if B.p_select(pr, "상태") == B.TALK_STATUS_HIDDEN:
            continue
        title = B.p_text(pr, "제목")
        out.append({
            "date": (B.p_date(pr, "일자").get("start") or "")[:10],
            "channel": channel, "title": title,
            "preview": B.nn(B.p_text(pr, "요약")), "body": None,
            "body_html": B.fetch_talk_body(nt, pg["id"], title) or None,
            "direction": B.p_select(pr, "방향"),
        })
    return out


# ══════════════════════════════════════════════════════════════════════════

def main() -> int:
    ap = argparse.ArgumentParser(description="다른 클라이언트를 샘플에 합친다")
    ap.add_argument("--company", required=True, help="기업 DB 의 기업명")
    ap.add_argument("--dry-run", action="store_true", help="아무것도 쓰지 않는다")
    ap.add_argument("--talks-only", action="store_true",
                    help="프로젝트는 건드리지 않고 소통 내역만 합친다 "
                         "(원본 자신을 다시 읽어 잘린 메일을 채울 때)")
    args = ap.parse_args()

    cfg = MERGE_SOURCES.get(args.company)
    if cfg is None:
        raise SystemExit(f"MERGE_SOURCES 에 {args.company!r} 설정이 없습니다. "
                         "src/merge_sample.py 상단에 추가하세요.")
    apply_source_rules(cfg)

    load_dotenv(ROOT / ".env")
    nt = B.Notion(os.environ["NOTION_TOKEN"])
    B._ASSET_CTX["slug"] = M.SAMPLE_SLUG
    B._ASSET_CTX["dry_run"] = args.dry_run

    print(f"▶ {args.company}")
    if args.talks_only:
        projects = []
        print("  프로젝트 건너뜀 (--talks-only)")
    else:
        company_id = find_company(nt, args.company)
        projects = fetch_projects(nt, company_id, cfg.get("projects") or [])
        print(f"  프로젝트 {len(projects)}건")

    client_page = find_client_page(nt, args.company)
    meetings = fetch_meetings(nt, client_page) if client_page else []
    print(f"  미팅·유선 {len(meetings)}건")

    mails = fetch_mails(args.company, cfg.get("talks_days", 0),
                        cfg.get("exclude_title") or "")
    print(f"  메일 {len(mails)}건")

    sub = M.walk({"progress": projects, "talks": mails + meetings}, [])
    M.cut_signatures(sub["talks"])
    projects, talks = sub["progress"], sub["talks"]

    print("\n마스킹 건수")
    for k in M.REPORT_ORDER:
        if M.stats.get(k):
            print(f"  {k:16} {M.stats[k]:>4}건")

    blob = json.dumps({"progress": projects, "talks": talks}, ensure_ascii=False)
    print("\n금지어 검사 (합칠 부분만)")
    bad = 0
    words = M.FORBIDDEN + (cfg.get("names") or []) + (cfg.get("brands") or []) \
        + (cfg.get("domains") or []) + list(cfg.get("people") or {})
    for w in sorted(set(words)):
        n = len(re.findall(re.escape(w), blob, re.I))
        bad += n
        print(f"  {w:22} {n}건{'   ← 남아 있음' if n else ''}")

    if args.dry_run:
        print(f"\n(dry-run) 합치지 않음 — 프로젝트 {len(projects)} · 소통 {len(talks)}")
        return 1 if bad else 0
    if bad:
        print("\n⚠ 금지어가 남아 있어 합치지 않았습니다.")
        return 1

    path = ROOT / "c" / f"{M.SAMPLE_SLUG}.json"
    env = json.loads(path.read_text(encoding="utf-8"))
    d = env["data"]
    have = {(t["date"], t["title"]) for t in d["talks"]}
    add = [t for t in talks if (t["date"], t["title"]) not in have]

    if projects:
        d["progress"] = sorted(d["progress"] + projects,
                               key=lambda r: (r["start"] or "", r["title"]),
                               reverse=True)
    d["talks"] = sorted(d["talks"] + add, key=lambda t: t["date"], reverse=True)
    k = d.setdefault("kpi", {})
    k["running"] = sum(1 for r in d["progress"] if r["badge"] == "run")
    k["done"] = sum(1 for r in d["progress"] if r["badge"] == "ok")
    k["certs"] = sum(1 for r in d["progress"]
                     if r["cat"] == "cert" and r["badge"] == "ok")

    out = json.dumps(env, ensure_ascii=False, separators=(",", ":"))
    B.atomic_write_bytes(path, out.encode("utf-8"))
    print(f"\nprogress {len(d['progress'])} · talks {len(d['talks'])}"
          f" (새로 넣은 소통 {len(add)}, 중복 {len(talks) - len(add)})")
    print(f"kpi running={k['running']} done={k['done']} certs={k['certs']}")
    print(f"c/{M.SAMPLE_SLUG}.json {len(out.encode('utf-8')):,}B")
    print("이어서 python src/scan_sample.py 로 전수 스캔을 돌리세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
