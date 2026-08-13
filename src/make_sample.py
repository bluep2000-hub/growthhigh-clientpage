"""클라이언트 하나를 복제해 공개 데모용 `c/{샘플슬러그}.json` 을 만든다.

원본은 아무것도 바꾸지 않는다. `c/{원본}.enc` 를 풀어 메모리 위의 사본에만
치환을 걸고, 평문 봉투(`enc:false`)로 쓴다. 노션에도 쓰지 않는다 —
비밀번호를 가져오려고 읽기만 한다.

`index.html` 은 슬러그가 `sample` 이면 이 파일을 읽고 비밀번호 게이트를 건너뛴다.

    python src/make_sample.py            # 만든다
    python src/make_sample.py --check    # 만들지 않고 검사만 한다

새 샘플을 만들 때 고칠 곳은 아래 「설정」 블록 하나뿐이다.
그 아래 「영구 규칙」은 클라이언트와 무관하게 늘 적용된다 — 지우지 말 것.

⚠ 이 스크립트는 산출물을 통째로 다시 만든다. 손으로 고친 내용
(merge_sample.py 로 병합한 다른 클라이언트, 직접 편집한 공지 등)은 사라진다.
자세한 절차는 README 「새 샘플 만들기」를 볼 것.
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

# ══════════════════════════════════════════════════════════════════════════
# 설정 — 새 샘플을 만들 때 여기만 고친다
# ══════════════════════════════════════════════════════════════════════════

SOURCE_SLUG = "studiolb"           # 복제할 원본 클라이언트
SAMPLE_SLUG = "game"               # 산출물 c/{이것}.json · assets/notice/{이것}-*

# 추천 지원사업만 원본을 복제하지 않고 Firestore 에서 따로 읽는다.
# playlists/{이 이름} 문서를 미리 만들어 둘 것. 없으면 recommend=[] 가 된다.
PLAYLIST = "스튜디오에이블"

# 샘플에 나갈 새 표기
NEW_NAME = "스튜디오에이블"
NEW_EN = "StudioAble"
NEW_EN_CORP = "StudioAble Co.,Ltd."
NEW_DOMAIN = "studioable.co.kr"

# 원본에서 지울 표기. 긴 것부터 쓴다 — 앞의 규칙이 뒤를 먹지 않게.
SRC_NAMES = ["주식회사 스튜디오엘비", "주식회사스튜디오엘비",
             "(주)스튜디오엘비", "스튜디오엘비"]
SRC_BRANDS = []                    # 한글 브랜드. 영문 상호는 SRC_EN 이 맡는다
SRC_DOMAINS = ["studiolb.co.kr"]
SRC_EN = [r"studio\s*lb"]          # 영문 상호. 정규식이라 대소문자·띄어쓰기를 가린다

# 지우지 않고 가명으로 바꿀 고유명. 정규식이라 띄어쓰기 변형을 가린다.
# 긴 것을 먼저 둔다 — 위에서 걸리면 아래는 보지 않는다.
SRC_ALIASES = [
    # 관계사. storytunes.net 은 가명이 아니라 example.com 으로 지운다
    (r"story\s*tunes\.net", "example.com"),
    (r"스토리\s*튠즈", "스토리웨이브"),
    (r"story\s*tunes", "Storywave"),
    # 게임·원작 IP 타이틀
    (r"테이밍\s*마스터\s*[:：]\s*소환수\s*키우기", "소환의 주인: 정령 키우기"),
    (r"테이밍\s*마스터", "소환의 주인"),
    (r"재능\s*삼킨\s*마법사", "마력을 삼킨 자"),
    (r"블루\s*아이즈\s*[:：]\s*길드\s*마스터", "실버아이즈: 길드마스터"),
    (r"블루\s*아이즈", "실버아이즈"),
    # 상표·앱 패키지에 영문 표기로도 나온다
    (r"blue\s*eyes\s*guild\s*master", "SILVER EYES GUILDMASTER"),
    (r"blue[\s_-]?eyes", "SilverEyes"),
    (r"taming\s*master", "Summon Master"),
    (r"환생자의\s*스트리밍", "회귀자의 방송국"),
    (r"환생자", "회귀자"),
    (r"성검\s*전설", "은검전설"),              # 지시에 없던 개발 중 타이틀
    # 같은 사업에 묶여 프로젝트명에 박힌 다른 고객사
    (r"코스리움", "라온코스"),
    (r"브릭\s*앤\s*이든", "하늘앤이든"),
    (r"씨엔\s*코스메틱", "대성코스메틱"),
]

# 공용 메일(naver·nate 등)에 쓰는 개인 계정. 로컬파트에 사명·실명이 들어가면
# 도메인 치환만으로는 남는다. 통째로 적어 둔다.
SRC_ACCOUNTS = {}

# 클라이언트 측 인명 → 마스킹. 성만 남긴다.
PEOPLE = {
    "박태석": "박○○",                        # 대표 겸 원작 웹소설 작가
    "박상훈": "박○○",
    "정연지": "정○○",
    "흑아인": "○○○",                         # 필명 — 검색하면 원작과 회사가 나온다
    # 급여·이체·4대보험 서류에 딸려 온 재직자·지원자. 지시에는 없었으나 실명이다.
    "김지용": "김○○", "송준석": "송○○", "장성택": "장○○", "최재혁": "최○○",
    "김성민": "김○○", "전지호": "전○○", "장민준": "장○○",
}
PEOPLE_EN = {}
# 그로스하이 측은 남긴다. 여기 있는 이름은 마스킹 대상에서 뺀다.
KEEP_PEOPLE = ["박재현", "윤범상", "양승현", "김수정", "박윤경", "윤현교"]

# 원본 소재지. 시(市)까지만 남기고 그 아래를 가린다.
SRC_ADDRESS = [
    (r"성수일로\s*\d+", "○○로 ○○"),
    (r"\(성수동[^)]*\)", "(○○동)"),
    (r"성수동\s*\d*가?", "○○동"),
    (r"서울숲\s*AK\s*밸리\s*지식산업센터", "○○지식산업센터"),
    (r"서울숲", "○○"),
    (r"성동구", "○○구"),
    (r"(?<!\d)405\s*,?\s*406\s*호", "○○호"),
    (r"Seongsuil-ro\s*\d+", "○○-ro"),
    (r"Seongdong-gu", "○○-gu"),
]

# 원본 메일 서명에 박힌 태그라인. 서명 블록을 잘라내는 표지로 쓴다.
SRC_SIG_MARKS = []

# 첨부 파일명에서 살릴 사업·제도·서식 이름. 없으면 확장자만 남긴다.
PROGRAM_WORDS = [
    "수출바우처", "수출실적증명서", "게임더하기", "게임콘텐츠", "창구",
    "액셀러레이터", "콘텐츠완성보증", "문화산업완성보증", "정책자금",
    "융자신청서", "청년일자리도약장려금", "내일채움공제", "산학협약",
    "채용의뢰서", "병역지정업체", "병역특례", "기업부설연구소",
    "연구인력기초사항", "이노비즈", "메인비즈", "벤처인증", "벤처기업확인서",
    "중소기업확인서", "창업기업확인서", "사업계획서",
    "사업비사용실적보고서", "회사소개서", "조직도", "주주명부",
]

# 거래처·제3자 상호와 도메인. 데모에 필요 없다.
THIRD_PARTY = [
    (r"\b(sen\.go\.kr|ipzerone\.com|nate\.com)\b", "example.com"),
    # 병역특례 산학협약 학교. 협약 상대가 드러나면 기업도 좁혀진다
    (r"한세\s*사이버\s*보안고(?:등학교)?", "○○고등학교"),
    (r"인덕\s*과학기술고(?:등학교)?", "○○고등학교"),
    (r"서울(?:특별)?시\s*교육청", "○○교육청"),
    # 대표 개인의 다른 사업체·외부 대행사
    (r"레이지\s*하우스", "○○○"),
    (r"삼덕\s*회계법인", "○○회계법인"),
    (r"헬프\s*미", "상표대행사"),
    # 클라이언트가 공개해 둔 노션 사이트. 슬러그를 갈아도 살아 있는 주소처럼
    # 남는다. 우리 워크스페이스(yuncommon)만 남기고 나머지는 지운다.
    (r"https?://(?!yuncommon\.)[\w.-]*\.notion\.site/\S*", "https://example.com/"),
]

# 만들고 나서 전문을 훑는다. 하나라도 남으면 배포하지 않는다.
FORBIDDEN = ["스튜디오엘비", "studiolb", "StudioLB", "STUDIOLB", "Studio LB",
             "스토리튠즈", "storytunes",
             "코스리움", "브릭앤이든", "씨엔코스메틱",
             "테이밍", "재능삼킨", "블루 아이즈", "환생자",
             "박태석", "박상훈", "흑아인", "정연지", "성검전설",
             "김지용", "송준석", "장성택", "최재혁", "김성민", "전지호", "장민준",
             "인덕과학기술고", "한세사이버보안고", "레이지하우스", "삼덕회계법인",
             "sen.go.kr", "ipzerone", SOURCE_SLUG]

# ══════════════════════════════════════════════════════════════════════════
# 영구 규칙 — 클라이언트가 바뀌어도 그대로 둔다
# ══════════════════════════════════════════════════════════════════════════

# 메일 본문에 정부지원 시스템 계정이 그대로 오간다. 값은 남기지 않는다.
# 「ID / PW 공유 부탁드립니다」처럼 값이 없는 문장은 건드리지 않는다.
CRED_RE = re.compile(
    r"(?i)((?:\bID\b|\bPW\b|\bPASSWORD\b|아이디|비번|비밀번호)\s*[:：]\s*)"
    r"([^\s|,]+?)(?=\s|$|,|\||비번|비밀번호|아이디)")
CRED_MASK = "●●●●●●"

# 라벨은 분류용이고 동작과 무관하다. 순서가 곧 적용 순서다.
PERMANENT_RULES: list[tuple[str, str, str]] = [
    # 도로명 주소 일반형. 사옥뿐 아니라 본문에 섞인 자택 주소까지 잡는다.
    ("주소", r"[가-힣]{2,6}(?:대로|로)\s?\d+길\s*\d+(?:-\d+)?(?:\s*,?\s*\d+호)?",
     "○○로 ○○"),
    ("전화번호", r"(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)", "0**-****-****"),
    ("계좌번호", r"(?<!\d)\d{3}-\d{3}-\d{6}(?!\d)", "***-***-******"),
    # FDA Product Listing 같은 공개 등록번호. 등록부에서 실기업을 되짚을 수 있다.
    ("등록번호", r"(?<!\d)\d{2,3}-\d{4,6}-\d{5,6}(?!\d)", "**-******-******"),
    ("사업자번호", r"(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)", "***-**-*****"),
    ("사업자번호", r"(?<!\d)\d{10}(?!\d)", "**********"),
    # 특허 등록번호. 공개 등록부에서 출원인이 바로 나온다.
    ("특허번호", r"제\s*10-\d{6,8}\s*호", "제10-○○○○○○○호"),
    # 자사 채용공고. 열면 실기업이 그대로 드러난다 — 주소째 지운다.
    ("채용공고",
     r"https?://(?:www\.)?(?:saramin\.co\.kr/zf_user|jobkorea\.co\.kr"
     r"|gamejob\.co\.kr)/\S*",
     "https://example.com/"),
    # 앱마켓·홍보영상. 앱 이름과 패키지명이 URL 안에 그대로 있고, 한글은
    # 퍼센트 인코딩이라 글자 치환으로는 안 걸린다 — 주소째 지운다.
    ("앱마켓링크",
     r"https?://(?:apps\.apple\.com|play\.google\.com|youtu\.be"
     r"|(?:www\.)?youtube\.com|onestore\.co\.kr)/\S*",
     "https://example.com/"),
    # 메일 대용량 첨부 다운로드 링크. 토큰이 살아 있으면 첨부를 그대로 받아간다.
    ("메일첨부링크", r"https?://[\w.-]*daouoffice\.com/\S*", "https://example.com/"),
]

# 구글드라이브. 공지에서는 링크가 아니라 글자뿐인 경우가 많다(노션에서 href 없이 적힌다).
DRIVE_RE = re.compile(r"(drive|docs)\.google\.com|구글\s*드라이브|google\s*drive", re.I)
DRIVE_LINE_RE = re.compile(r"(?m)^.*구글\s*드라이브.*$\n?")

ATTACH_PREFIX = "첨부: "
SIG_MIN_KEEP = 30          # 서명을 자른 뒤 이보다 짧아지면 본문을 비운다

# ══════════════════════════════════════════════════════════════════════════
# 설정에서 규칙을 조립한다
# ══════════════════════════════════════════════════════════════════════════


def _build_rules() -> list[tuple[str, str]]:
    """단순 문자열 치환. 긴 것부터 적용되도록 순서를 지킨다."""
    out: list[tuple[str, str]] = []
    for name in SRC_NAMES:
        new = name.replace(SRC_NAMES[-1], NEW_NAME) if SRC_NAMES[-1] in name else NEW_NAME
        out.append((name, new))
    for acc, new in SRC_ACCOUNTS.items():
        out.append((acc, new))
    for dom in SRC_DOMAINS:
        out.append((dom, NEW_DOMAIN))
    for brand in SRC_BRANDS:
        if brand.isupper():
            out.append((brand, NEW_EN.upper()))
        elif brand[0].isupper() and brand[1:].islower():
            out.append((brand, NEW_EN.capitalize()))
        elif brand.islower() and brand.isascii():
            out.append((brand, NEW_EN.lower()))
        else:
            out.append((brand, NEW_NAME))
    out.append((SOURCE_SLUG, SAMPLE_SLUG))
    return out


def _build_re_rules() -> list[tuple[re.Pattern, str]]:
    """영문 상호처럼 대소문자·띄어쓰기를 가리지 않아야 하는 것."""
    out = []
    # 가명 치환이 먼저다. 적어 둔 순서가 곧 적용 순서 — 긴 것이 위에 있다.
    for pat, new in SRC_ALIASES:
        out.append((re.compile(pat, re.I), new))
    for en in SRC_EN:
        out.append((re.compile(en + r"\s*co\.?,?\s*ltd\.?", re.I), NEW_EN_CORP))
        out.append((re.compile(en, re.I), NEW_EN))
    return out


def _build_mask_rules() -> list[tuple[str, re.Pattern, str]]:
    """라벨이 붙은 정규식 규칙. 사람·주소는 설정에서, 나머지는 영구 규칙에서 온다."""
    out: list[tuple[str, re.Pattern, str]] = []
    for name, masked in PEOPLE.items():
        if name in KEEP_PEOPLE:
            continue
        spaced = r"\s*".join(re.escape(ch) for ch in name)
        out.append(("사람이름", re.compile(spaced), masked))
    for pat, masked in PEOPLE_EN.items():
        out.append(("사람이름", re.compile(pat, re.I), masked))
    for pat, new in SRC_ADDRESS:
        out.append(("주소", re.compile(pat, re.I), new))
    for label, pat, new in PERMANENT_RULES:
        out.append((label, re.compile(pat, re.I), new))
    for pat, new in THIRD_PARTY:
        out.append(("제3자도메인", re.compile(pat, re.I), new))
    return out


def _build_sig_re() -> re.Pattern:
    """메일 끝 연락처 블록의 시작 표지. 여기서부터 끝까지 잘라낸다."""
    marks = list(SRC_SIG_MARKS) + [
        r"^\s*[_\-=–—]{3,}\s*$",                       # 구분선
        r"Republic of Korea",
        r"HR&GA\s*Part|Operations Support Manager",
    ]
    company = "|".join(re.escape(x) for x in (NEW_NAME, *SRC_NAMES))
    marks.append(rf"^\s*\(?\*?주\)?\*?\s*(?:{company})\s*서울")
    return re.compile("|".join(marks), re.I | re.M)


RULES = _build_rules()
RE_RULES = _build_re_rules()
MASK_RULES = _build_mask_rules()
SIG_RE = _build_sig_re()
MAIL_RE = re.compile(r"[\w.+-]+@(?:" +
                     "|".join(re.escape(d) for d in SRC_DOMAINS) + r")", re.I)
ASSET_RE = re.compile(rf"assets/notice/{SAMPLE_SLUG}-([0-9a-f]+)\.(\w+)")

stats: Counter = Counter()
attach_map: dict[str, str] = {}
sig_report: list[tuple] = []

# 보고 순서. 여기 없는 라벨도 stats 에는 쌓이지만 표에는 안 나온다.
REPORT_ORDER = ("제목", "본문", "표", "메일주소", "기타", "첨부파일명",
                "자격증명마스킹", "사람이름", "주소", "전화번호", "계좌번호",
                "사업자번호", "등록번호", "특허번호", "채용공고", "앱마켓링크",
                "메일첨부링크", "제3자도메인",
                "서명블록삭제", "본문전체가서명", "드라이브참조줄삭제",
                "드라이브항목삭제", "드라이브링크속성", "빈섹션삭제", "로고제거")


# ══════════════════════════════════════════════════════════════════════════
# 치환
# ══════════════════════════════════════════════════════════════════════════

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


def walk(node, path: list[str]):
    """payload 트리의 모든 문자열에 치환을 건다."""
    if isinstance(node, str):
        text = scrub_attachments(node) if ATTACH_PREFIX in node else node
        return scrub_text(text, path)
    if isinstance(node, list):
        return [walk(v, path) for v in node]
    if isinstance(node, dict):
        return {k: walk(v, path + [k]) for k, v in node.items()}
    return node


# ══════════════════════════════════════════════════════════════════════════
# 구글드라이브 · 서명 블록
# ══════════════════════════════════════════════════════════════════════════

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


def drop_drive_lines(text: str) -> str:
    """본문에 남은 드라이브 참조 줄. 주소는 떨어져 나가고 글자만 남아 있다."""
    out, n = DRIVE_LINE_RE.subn("", text)
    if n:
        stats["드라이브참조줄삭제"] += n
    return out.rstrip()


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
        out = tail or None
        return out, "empty", len(text), len(out or "")

    out = "\n".join(x for x in (kept, tail) if x)
    return out, "cut", len(text), len(out)


def cut_signatures(talks: list[dict]) -> None:
    """소통 내역의 본문·요약에서 서명 블록과 드라이브 참조 줄을 뗀다."""
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
            sig_report.append((t.get("date"), t.get("direction"), t.get("title"),
                               before, after, state))


# ══════════════════════════════════════════════════════════════════════════
# 자산 · 원본 읽기
# ══════════════════════════════════════════════════════════════════════════

def copy_assets(blob: str, dry: bool) -> list[str]:
    """치환된 경로가 가리키는 공지 이모지 이미지를 원본에서 복사한다."""
    made = []
    for h, ext in set(ASSET_RE.findall(blob)):
        src = ROOT / "assets" / "notice" / f"{SOURCE_SLUG}-{h}.{ext}"
        dst = ROOT / "assets" / "notice" / f"{SAMPLE_SLUG}-{h}.{ext}"
        if not src.exists():
            print(f"  ⚠ 원본 이미지 없음: {src.name}")
            continue
        if not dry:
            B.atomic_write_bytes(dst, src.read_bytes())
        made.append(dst.name)
    return sorted(made)


def missing_assets(blob: str) -> list[str]:
    """산출물이 가리키는 파일 중 실제로 없는 것."""
    out = []
    for path in set(re.findall(r"(assets/[\w./-]+|logo/[\w./-]+)", blob)):
        if not (ROOT / path).exists():
            out.append(path)
    return sorted(out)


def load_payload(slug: str = SOURCE_SLUG) -> dict:
    """c/{slug}.enc 를 풀어 payload 를 돌려준다. 노션에서 비밀번호만 읽는다."""
    env = json.loads((ROOT / "c" / f"{slug}.enc").read_text(encoding="utf-8"))
    if not env.get("enc"):
        return env["data"]

    load_dotenv(ROOT / ".env")
    nt = B.Notion(os.environ["NOTION_TOKEN"])
    clients, _ = B.fetch_clients(nt, slug)
    if not clients:
        raise SystemExit(f"{slug} 를 공유페이지 DB 에서 찾지 못했습니다.")
    password = clients[0]["password"]
    if not password:
        raise SystemExit("비밀번호가 비어 있어 원본을 풀 수 없습니다.")

    key = PBKDF2HMAC(algorithm=SHA256(), length=32,
                     salt=base64.b64decode(env["salt"]),
                     iterations=env["iterations"]).derive(password.encode("utf-8"))
    plain = AESGCM(key).decrypt(base64.b64decode(env["iv"]),
                                base64.b64decode(env["data"]), None)
    return json.loads(plain)


def report(blob: str, copied: list[str]) -> int:
    """치환 건수·금지어·서명 처리 결과를 찍고 문제 건수를 돌려준다."""
    print("치환 건수")
    for k in REPORT_ORDER:
        if stats.get(k):
            print(f"  {k:16} {stats[k]:>4}건")

    print("\n금지어 검사")
    bad = 0
    for word in FORBIDDEN:
        n = blob.count(word)
        bad += n
        print(f"  {word:14} {n}건 {'' if n == 0 else '  ← 남아 있음'}")

    gone = [p for p in missing_assets(blob) if Path(p).name not in copied]
    if gone:
        bad += len(gone)
        print(f"\n⚠ 가리키는데 없는 파일 {len(gone)}개: {', '.join(gone)}")

    if sig_report:
        print(f"\n서명 블록 처리 {len(sig_report)}건 (본문 길이 변화)")
        for d, direction, title, before, after, state in sig_report:
            note = "  ← 본문 전체가 서명이라 비움" if state == "empty" else ""
            print(f"  {d} {direction} {before:>5} -> {after:>5}  "
                  f"{(title or '')[:40]}{note}")

    if attach_map:
        print(f"\n첨부 파일명 {len(attach_map)}종")
        for src, dst in sorted(attach_map.items()):
            print(f"  {src[:64]:<64} -> {dst}")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description="공개 데모용 샘플 데이터 생성기")
    ap.add_argument("--check", action="store_true", help="파일을 쓰지 않고 검사만 한다")
    args = ap.parse_args()

    payload = load_payload()
    payload = walk(payload, [])
    strip_drive(payload)
    cut_signatures(payload.get("talks") or [])

    # 치환 뒤에 읽는다. 정책정보에서 갓 받은 값이라 치울 것이 없고,
    # 치환을 태우면 사업명이 엉뚱하게 바뀔 수 있다.
    payload["recommend"] = B.fetch_recommend(PLAYLIST, B.INCLUDE_EXPIRED)
    print(f"추천 지원사업 {len(payload['recommend'])}건 (playlists/{PLAYLIST})\n")

    # 로고는 원본 노션 아이콘이라 그대로 두면 진짜 회사 표식이 남는다.
    # 둘 다 비우면 index.html 이 기업명 앞 두 글자를 대신 그린다.
    # 데모용 로고를 쓰려면 logo/{샘플슬러그}.png 를 두고 아래를 그 경로로 바꾼다.
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

    bad = report(blob, copied)

    out = ROOT / "c" / f"{SAMPLE_SLUG}.json"
    if args.check:
        print(f"\n(check) {out} 쓰지 않음 · {len(blob.encode('utf-8')):,}B")
        return 1 if bad else 0

    B.atomic_write_bytes(out, blob.encode("utf-8"))
    print(f"\nc/{SAMPLE_SLUG}.json {len(blob.encode('utf-8')):,}B · enc=False")
    if bad:
        print("⚠ 금지어가 남아 있습니다. 배포하지 마세요.")
        return 1
    print("이어서 python src/scan_sample.py 로 전수 스캔을 돌리세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
