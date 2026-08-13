"""forest-avenue 를 복제해 공개 데모용 `c/sample.json` 을 만든다.

원본은 아무것도 바꾸지 않는다. `c/forest-avenue.enc` 를 풀어 메모리 위의
사본에만 치환을 걸고, 평문 봉투(`enc:false`)로 `c/sample.json` 에 쓴다.
노션에도 쓰지 않는다 — 읽기만 한다(비밀번호를 가져오기 위해서다).

index.html 은 슬러그가 `sample` 이면 이 파일을 읽고 비밀번호 게이트를 건너뛴다.

    python src/make_sample.py            # c/sample.json 을 만든다
    python src/make_sample.py --check    # 만들지 않고 검사만 한다
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_client as B                                   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC_SLUG = "forest-avenue"
DST_SLUG = "sample"

# 추천 지원사업만 원본을 복제하지 않고 따로 읽는다. Firestore 의
# playlists/{이 이름} 문서다 — 원본 클라이언트의 재생목록과 완전히 분리된다.
SAMPLE_PLAYLIST = "케이뷰티"

# ── 치환표 ──────────────────────────────────────────────────────────────
# 긴 것부터 건다. 「(주)포레스트에비뉴」는 마지막 규칙만으로도 처리되지만
# 표기를 눈으로 확인할 수 있게 남겨 둔다.
RULES: list[tuple[str, str]] = [
    ("주식회사 포레스트에비뉴", "주식회사 케이뷰티"),
    ("(주)포레스트에비뉴", "(주)케이뷰티"),
    ("포레스트 에비뉴", "케이뷰티"),
    ("포레스트에비뉴", "케이뷰티"),
    (SRC_SLUG, DST_SLUG),
    ("menokin.co.kr", "kbeauty.co.kr"),
    ("MENOKIN", "KBEAUTY"),
    ("Menokin", "Kbeauty"),
    ("menokin", "kbeauty"),
    ("메노킨", "케이뷰티"),
]

# 한글만 바꾸면 서명·영문 상호가 그대로 남는다. 대소문자·띄어쓰기를 가리지 않는다.
RE_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"forest\s*avenue\s*co\.?,?\s*ltd\.?", re.I), "KBEAUTY Co.,Ltd."),
    (re.compile(r"forest\s*avenue", re.I), "KBEAUTY"),
]

# 메일 본문에 정부지원 시스템 계정이 그대로 오간다. 공개본에는 값을 남기지 않는다.
# 「ID / PW 공유 부탁드립니다」처럼 값이 없는 문장은 건드리지 않는다.
CRED_RE = re.compile(
    r"(?i)((?:\bID\b|\bPW\b|\bPASSWORD\b|아이디|비번|비밀번호)\s*[:：]\s*)"
    r"([^\s|,]+?)(?=\s|$|,|\||비번|비밀번호|아이디)")
CRED_MASK = "●●●●●●"

# ── 추가 마스킹 ─────────────────────────────────────────────────────────
# 공개 평문 페이지라 URL 만 알면 그대로 보인다. 데모에 필요 없는 식별 정보는
# 여기서 지운다. 그로스하이 측 이름·메일과 기관명·사업명·금액·날짜는 남긴다.
MASK_RULES: list[tuple[str, re.Pattern, str]] = [
    # 클라이언트 측 사람 — 성만 남긴다
    ("사람이름", re.compile(r"이\s*준\s*희"), "이○○"),
    ("사람이름", re.compile(r"이\s*한\s*별"), "이○○"),
    ("사람이름", re.compile(r"이\s*보\s*경"), "이○○"),
    ("사람이름", re.compile(r"임\s*솔"), "임○"),
    ("사람이름", re.compile(r"junhee\s+lee|hanbyeol\s+lee", re.I), "LEE"),
    ("사람이름", re.compile(r"\bsol\s+lim\b", re.I), "LIM"),
    ("사람이름", re.compile(r"\bbo\s?kyung\s+lee\b", re.I), "LEE"),
    # 그로스하이 측은 남긴다 — 박재현·윤범상·양승현에 더해 김수정(이사/기업운영팀)·
    # 박윤경(리서처)도 growthhigh.co.kr 소속이라 마스킹하지 않는다.
    ("사람이름", re.compile(r"추\s*성\s*국"), "추○○"),   # 클라이언트 상무
    ("사람이름", re.compile(r"정\s*신\s*자"), "정○○"),   # 중진공 담당자
    # 메일 계정 하나만 따로 바꾼다
    ("계정치환", re.compile(r"\bsol@"), "sl@"),
    # 주소 — 시(市)까지만 남기고 그 아래를 가린다
    # 도로명 주소 일반형. 사옥뿐 아니라 본문에 섞인 자택 주소까지 잡는다.
    ("주소", re.compile(r"[가-힣]{2,6}(?:대로|로)\s?\d+길\s*\d+(?:-\d+)?"
                        r"(?:\s*,?\s*\d+호)?"), "○○로 ○○"),
    ("주소", re.compile(r"방배로\s*\d+\s*길\s*\d+"), "○○로 ○○"),
    ("주소", re.compile(r"\(방배동[^)]*\)"), "(○○동)"),
    ("주소", re.compile(r"방배동"), "○○동"),
    ("주소", re.compile(r"미도빌딩"), "○○빌딩"),
    ("주소", re.compile(r"서초구"), "○○구"),
    ("주소", re.compile(r"Bangbae-ro\s*\d+-gil", re.I), "○○-ro"),
    ("주소", re.compile(r"Seocho-gu", re.I), "○○-gu"),
    ("주소", re.compile(r"\b3F,\s*18,?"), "○F, ○○,"),
    ("주소", re.compile(r"\b06562\b"), "00000"),
    # 연락처
    ("전화번호", re.compile(r"(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"),
     "0**-****-****"),
    # 계좌·사업자등록번호
    ("계좌번호", re.compile(r"(?<!\d)\d{3}-\d{3}-\d{6}(?!\d)"), "***-***-******"),
    # FDA Product Listing 같은 공개 등록번호. 등록부에서 실기업을 되짚을 수 있다.
    ("등록번호", re.compile(r"(?<!\d)\d{2,3}-\d{4,6}-\d{5,6}(?!\d)"), "**-******-******"),
    ("사업자번호", re.compile(r"(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)"), "***-**-*****"),
    ("사업자번호", re.compile(r"(?<!\d)\d{10}(?!\d)"), "**********"),
    # 제3자 상호·도메인
    ("제3자도메인", re.compile(r"\b(storytunes\.net|green-cos\.com|dasancpa\.com)\b",
                          re.I), "example.com"),
    ("제3자도메인", re.compile(r"\bgreen\s*cos\b", re.I), "○○○"),
]

# 남아 있으면 안 되는 흔적. 만들고 나서 전문을 훑는다.
FORBIDDEN = ["포레스트", "에비뉴", "menokin", "MENOKIN", "메노킨", SRC_SLUG,
             "forest", "avenue"]

# 메일 주소는 계정(@ 앞)을 남기고 도메인만 바꾼다. 몇 건인지 따로 센다.
MAIL_RE = re.compile(r"[\w.+-]+@(?:menokin\.co\.kr)", re.I)

# 첨부 파일명에서 살릴 사업·제도·서식 이름. 여기 없으면 확장자만 남긴다.
PROGRAM_WORDS = [
    "창업도약패키지", "K-수출스타", "K수출스타", "수출바우처", "혁신바우처",
    "수출리스크", "해외규격인증", "기업부설연구소", "연구인력기초사항",
    "이노비즈", "메인비즈", "벤처인증", "벤처기업확인서", "중소기업확인서",
    "창업기업확인서", "여성기업확인서", "정책자금", "융자신청서",
    "사업계획서", "사업비사용실적보고서", "ESG 자가진단", "수출실적증명서",
    "기술혁신개발사업", "브랜드소개서", "조직도", "주주명부",
]

# 공지의 드라이브 항목은 링크가 아니라 글자뿐이다(노션에서 href 없이 적혀 있다).
# 주소와 글자를 둘 다 본다.
DRIVE_RE = re.compile(r"(drive|docs)\.google\.com|구글\s*드라이브|google\s*drive", re.I)
ATTACH_PREFIX = "첨부: "

# 공지 안의 커스텀 이모지는 슬러그별 파일로 내려받혀 있다. 경로가 치환되면
# sample-*.png 를 가리키게 되므로 원본에서 같은 이름으로 복사해 둔다.
ASSET_RE = re.compile(rf"assets/notice/{DST_SLUG}-([0-9a-f]+)\.(\w+)")

stats: Counter = Counter()
attach_map: dict[str, str] = {}


# ── 문자열 치환 ─────────────────────────────────────────────────────────

def bucket(path: list[str], text: str) -> str:
    """치환 건수를 어디로 셀지 정한다. 보고용 분류일 뿐 동작과는 무관하다."""
    key = path[-1] if path else ""
    if "<table" in text:
        return "표"
    if key in ("title", "heading", "heading_html", "name"):
        return "제목"
    if key in ("preview", "body", "body_html", "html", "log_text", "biz",
               "stage_label", "address"):
        return "본문"
    return "기타"


def scrub_text(text: str, path: list[str]) -> str:
    if not text:
        return text
    before = text
    mails = len(MAIL_RE.findall(text))
    for old, new in RULES:
        if old in text:
            stats[bucket(path, before)] += text.count(old)
            text = text.replace(old, new)
    for pat, new in RE_RULES:
        text, n = pat.subn(new, text)
        if n:
            stats[bucket(path, before)] += n
    text, n = CRED_RE.subn(lambda m: m.group(1) + CRED_MASK, text)
    if n:
        stats["자격증명마스킹"] += n
    for label, pat, new in MASK_RULES:
        text, n = pat.subn(new, text)
        if n:
            stats[label] += n
    if mails:
        stats["메일주소"] += mails
    return text


# ── 첨부 파일명 ─────────────────────────────────────────────────────────

def scrub_filename(name: str) -> str:
    """확장자만 남긴다. 사업·서식 이름이 들어 있으면 그것만 살린다."""
    name = name.strip()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    stem = name[: -(len(ext) + 1)] if ext else name
    hit = next((w for w in PROGRAM_WORDS if w in stem), None)
    out = f"{hit}.{ext}" if hit and ext else (hit or ext or "파일")
    attach_map[name] = out
    return out


def scrub_attachments(text: str) -> str:
    """본문 끝의 「첨부: …」 한 줄을 파일명만 골라 바꾼다."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if not line.startswith(ATTACH_PREFIX):
            continue
        names = [n.strip() for n in line[len(ATTACH_PREFIX):].split(",") if n.strip()]
        if not names:
            continue
        lines[i] = ATTACH_PREFIX + ", ".join(scrub_filename(n) for n in names)
        stats["첨부파일명"] += len(names)
    return "\n".join(lines)


# ── 트리 순회 ───────────────────────────────────────────────────────────

def walk(node, path: list[str]):
    if isinstance(node, str):
        text = scrub_attachments(node) if ATTACH_PREFIX in node else node
        return scrub_text(text, path)
    if isinstance(node, list):
        return [walk(v, path) for v in node]
    if isinstance(node, dict):
        return {k: walk(v, path + [k]) for k, v in node.items()}
    return node


def drop_drive_items(items: list[dict]) -> list[dict]:
    """구글드라이브 링크는 항목째 뺀다. 자식 안에 있으면 그 자식만 뺀다."""
    out = []
    for it in items:
        if DRIVE_RE.search(it.get("html") or ""):
            stats["드라이브항목삭제"] += 1
            continue
        kids = it.get("children") or []
        if kids:
            it = {**it, "children": drop_drive_items(kids)}
        out.append(it)
    return out


def strip_drive(payload: dict) -> None:
    co = payload.get("company") or {}
    for key in ("drive_url", "bizplan_url"):
        if co.get(key) and DRIVE_RE.search(co[key]):
            co[key] = None
            stats["드라이브링크속성"] += 1
    co["extra_links"] = [l for l in (co.get("extra_links") or [])
                         if not DRIVE_RE.search(l.get("url") or "")]

    notice = payload.get("notice")
    if not notice:
        return
    sections = []
    for sec in notice.get("sections") or []:
        sec = {**sec, "items": drop_drive_items(sec.get("items") or [])}
        if not sec["items"]:
            stats["빈섹션삭제"] += 1
            continue
        sections.append(sec)
    notice["sections"] = sections


# ── 원본 읽기 ───────────────────────────────────────────────────────────

# ── 서명 블록 ───────────────────────────────────────────────────────────
# 메일 끝에 붙는 연락처 블록과 그 뒤의 인용 헤더를 통째로 뗀다. 본문은
# 「감사합니다 / OOO 드림」까지다. 그로스하이 쪽은 이름 한 줄뿐이라 걸리지 않는다.
SIG_RE = re.compile(
    r"(?:KBEAUTY|MENOKIN)?\s*Time\s+Saving\s+Minimal\s+Skincare"
    r"|^\s*[_\-=–—]{3,}\s*$"
    r"|^\s*\(?\*?주\)?\*?\s*(?:케이뷰티|포레스트에비뉴)\s*서울"
    r"|Republic of Korea"
    r"|HR&GA\s*Part|Operations Support Manager",
    re.I | re.M)

# 잘라낸 뒤 이보다 짧아지면 자르지 않는다 — 본문이 통째로 날아가는 것을 막는다.
SIG_MIN_KEEP = 30

sig_report: list[tuple] = []


def cut_signature(text: str) -> tuple[str | None, str, int, int]:
    """(자른 본문, 상태, 원래 길이, 남은 길이). 첨부 줄은 지키고 되붙인다.

    상태는 셋이다.
      cut   서명 앞의 본문이 남았다
      empty 본문이 통째로 서명이었다 — 첨부 줄만 남기고 비운다
      none  서명이 없다
    """
    lines = text.split("\n")
    tail = ""
    if lines and lines[-1].startswith(ATTACH_PREFIX):
        tail, lines = lines[-1], lines[:-1]
    core = "\n".join(lines)

    m = SIG_RE.search(core)
    if not m:
        return text, "none", len(text), len(text)

    kept = core[:m.start()].rstrip()
    if len(kept) < SIG_MIN_KEEP:
        # 남는 게 없다 = 본문이 서명뿐이었다. 서명을 남기느니 본문을 비운다.
        out = tail or None
        return out, "empty", len(text), len(out or "")

    out = "\n".join(x for x in (kept, tail) if x)
    return out, "cut", len(text), len(out)


# 본문에 남은 드라이브 링크 참조 줄. 주소는 이미 떨어져 나가 글자만 남아 있다.
DRIVE_LINE_RE = re.compile(r"(?m)^.*구글\s*드라이브.*$\n?")


def drop_drive_lines(text: str) -> str:
    out, n = DRIVE_LINE_RE.subn("", text)
    if n:
        stats["드라이브참조줄삭제"] += n
    return out.rstrip()


def cut_signatures(talks: list[dict]) -> None:
    for t in talks:
        for field in ("body", "preview"):
            if t.get(field) and "구글" in t[field]:
                t[field] = drop_drive_lines(t[field])
        for field in ("body", "preview"):
            src = t.get(field)
            if not src:
                continue
            out, state, before, after = cut_signature(src)
            if state == "none":
                continue
            t[field] = out
            if field != "body":
                continue
            stats["서명블록삭제" if state == "cut" else "본문전체가서명"] += 1
            sig_report.append((t["date"], t["direction"], t["title"],
                               before, after, state))


def copy_assets(blob: str, dry: bool) -> list[str]:
    """치환된 경로가 가리키는 이모지 이미지를 원본에서 복사한다."""
    made = []
    for h, ext in set(ASSET_RE.findall(blob)):
        src = ROOT / "assets" / "notice" / f"{SRC_SLUG}-{h}.{ext}"
        dst = ROOT / "assets" / "notice" / f"{DST_SLUG}-{h}.{ext}"
        if not src.exists():
            print(f"  ⚠ 원본 이미지 없음: {src.name}")
            continue
        if not dry:
            B.atomic_write_bytes(dst, src.read_bytes())
        made.append(dst.name)
    return sorted(made)


def missing_assets(blob: str) -> list[str]:
    """sample.json 이 가리키는 파일 중 실제로 없는 것."""
    out = []
    for path in set(re.findall(r"(assets/[\w./-]+|logo/[\w./-]+)", blob)):
        if not (ROOT / path).exists():
            out.append(path)
    return sorted(out)


def load_payload() -> dict:
    env = json.loads((ROOT / "c" / f"{SRC_SLUG}.enc").read_text(encoding="utf-8"))
    if not env.get("enc"):
        return env["data"]

    load_dotenv(ROOT / ".env")
    nt = B.Notion(os.environ["NOTION_TOKEN"])
    clients, _ = B.fetch_clients(nt, SRC_SLUG)
    if not clients:
        raise SystemExit(f"{SRC_SLUG} 를 공유페이지 DB 에서 찾지 못했습니다.")
    password = clients[0]["password"]
    if not password:
        raise SystemExit("비밀번호가 비어 있어 원본을 풀 수 없습니다.")

    key = PBKDF2HMAC(algorithm=SHA256(), length=32,
                     salt=base64.b64decode(env["salt"]),
                     iterations=env["iterations"]).derive(password.encode("utf-8"))
    plain = AESGCM(key).decrypt(base64.b64decode(env["iv"]),
                                base64.b64decode(env["data"]), None)
    return json.loads(plain)


def main() -> int:
    ap = argparse.ArgumentParser(description="공개 데모용 sample 데이터 생성기")
    ap.add_argument("--check", action="store_true", help="파일을 쓰지 않고 검사만 한다")
    args = ap.parse_args()

    payload = load_payload()
    payload = walk(payload, [])
    strip_drive(payload)
    cut_signatures(payload.get("talks") or [])

    # 치환 뒤에 읽는다. 정책정보에서 갓 받은 값이라 치울 것이 없고,
    # 치환을 태우면 사업명이 엉뚱하게 바뀔 수 있다.
    payload["recommend"] = B.fetch_recommend(SAMPLE_PLAYLIST, B.INCLUDE_EXPIRED)
    print(f"추천 지원사업 {len(payload['recommend'])}건 "
          f"(playlists/{SAMPLE_PLAYLIST})\n")

    # 로고는 원본 노션 아이콘이라 그대로 두면 진짜 회사 표식이 남는다.
    # 둘 다 비우면 index.html 이 기업명 앞 두 글자를 대신 그린다.
    co = payload.setdefault("company", {})
    if co.get("logo") or co.get("logo_emoji"):
        stats["로고제거"] += 1
    co["logo"] = None
    co["logo_emoji"] = None

    envelope = {"v": 1, "enc": False, "data": payload}
    blob = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))

    copied = copy_assets(blob, args.check)
    if copied:
        print(f"공지 이모지 이미지 {len(copied)}개 복사"
              f"{' (check — 쓰지 않음)' if args.check else ''}: {', '.join(copied)}\n")

    print("치환 건수")
    for k in ("제목", "본문", "표", "메일주소", "계정치환", "기타", "첨부파일명",
              "자격증명마스킹", "사람이름", "주소", "전화번호", "계좌번호",
              "사업자번호", "등록번호", "제3자도메인", "서명블록삭제", "본문전체가서명",
              "드라이브참조줄삭제",
              "드라이브항목삭제", "드라이브링크속성", "빈섹션삭제", "로고제거"):
        if stats.get(k):
            print(f"  {k:16} {stats[k]:>4}건")

    print("\n금지어 검사 (c/sample.json 전문)")
    bad = 0
    for word in FORBIDDEN:
        n = blob.count(word)
        bad += n
        print(f"  {word:14} {n}건 {'' if n == 0 else '  ← 남아 있음'}")

    # --check 에서는 아직 복사하지 않았으므로 복사 예정인 것은 뺀다
    gone = [p for p in missing_assets(blob) if Path(p).name not in copied]
    if gone:
        bad += len(gone)
        print(f"\n⚠ 가리키는데 없는 파일 {len(gone)}개: {', '.join(gone)}")

    if sig_report:
        print(f"\n서명 블록 처리 {len(sig_report)}건 (본문 길이 변화)")
        for d, direction, title, before, after, state in sig_report:
            mark = f"{before:>5} -> {after:>5}"
            note = "  ← 본문 전체가 서명이라 비움" if state == "empty" else ""
            print(f"  {d} {direction} {mark}  {title[:40]}{note}")

    if attach_map:
        print(f"\n첨부 파일명 {len(attach_map)}종")
        for src, dst in sorted(attach_map.items()):
            print(f"  {src[:64]:<64} -> {dst}")

    out = ROOT / "c" / f"{DST_SLUG}.json"
    if args.check:
        print(f"\n(check) {out} 쓰지 않음 · {len(blob.encode('utf-8')):,}B")
        return 1 if bad else 0

    B.atomic_write_bytes(out, blob.encode("utf-8"))
    print(f"\nc/{DST_SLUG}.json {len(blob.encode('utf-8')):,}B · enc=False")
    if bad:
        print("⚠ 금지어가 남아 있습니다. 배포하지 마세요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
