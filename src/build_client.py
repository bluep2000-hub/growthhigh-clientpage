#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
클라이언트 페이지 빌더.

노션(공유페이지·기업·프로젝트·공지 DB) + Firestore 재생목록 + 정책정보 메타를 모아
클라이언트별 JSON 을 만들고, 비밀번호로 암호화해 c/{슬러그}.enc 로 떨군다.
화면(index.html)은 손대지 않는다. 이 스크립트는 데이터만 만든다.

    python src/build_client.py --client whiffkorea

토큰은 .env 의 NOTION_TOKEN 에서 읽는다. 코드·로그·JSON 어디에도 남기지 않는다.
"""

from __future__ import annotations

import argparse
import base64
import imaplib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from email import message_from_bytes
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path

import requests

from check_imap import decode_mime, imap_utf7_decode
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from dotenv import load_dotenv

# ══════════════════════════════════════════════════════════════════════════
# 상수
# ══════════════════════════════════════════════════════════════════════════

ROOT = Path(__file__).resolve().parent.parent

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"

# 검증된 ID. data_sources 라우트는 쓰지 않는다 — database_id + 2022-06-28 조합이다.
SHARE_DB_ID = "21e815d7-12b9-80dc-8310-d038abd8a502"   # 공유페이지 DB (클라이언트 레지스트리)
COMPANY_DB_ID = "67e04cfc-4033-4465-ae05-1ab6bf774627"  # 기업 DB
PROJECT_DB_ID = "e1d03e45-f7f9-42c1-88f8-7f4595efe2a1"  # 프로젝트 DB

# 공유페이지 DB 의 「페이지 유형」에서 클라이언트페이지를 고르는 값.
# 이모지에 ZWJ 가 들어 있어 리터럴로 박으면 눈에 안 보인다. 명시적으로 조립한다.
CLIENT_PAGE_TYPE = "\U0001F468‍\U0001F4BC" + "클라이언트페이지"

PLAYLIST_URL = ("https://firestore.googleapis.com/v1/projects/growthhigh-playlist"
                "/databases/(default)/documents/playlists/{name}")
POLICY_DATA_URL = "https://bluep2000-hub.github.io/growthhigh-policy/data-full.json"
POLICY_BASE_URL = "https://bluep2000-hub.github.io/growthhigh-policy/"

# 마감이 지난 추천 사업·일정도 내보낼지. 운영 전환 시 False.
INCLUDE_EXPIRED = True

PBKDF2_ITERATIONS = 200_000

# 노션 요청 간 최소 간격. 공지 한 장에 13~30 요청이 나가므로 스로틀이 필요하다.
NOTION_MIN_INTERVAL = 0.35
MAX_RETRIES = 3

# ── 프로젝트 유형 → cat ──────────────────────────────────────────────────
CAT_BY_TYPE = {
    "(런웨이)지원사업": "fund",
    "(런웨이)정책과제": "fund",
    "(런웨이)정책자금": "fund",
    "(런웨이)고용지원": "fund",
    "(런웨이)기타지원": "fund",
    "(밸류업)기업인증": "cert",
    "(밸류업)병역특례": "cert",
    "(밸류업)지식재산권": "cert",
    "(킥오프)R&D기획": "proj",
    "(BM고도화)법인/구조개선": "proj",
    "(BM고도화)조사분석고도화": "proj",
    "(밸류업)재무구조개선": "proj",
    "(경영지도&자문)": "proj",
    "(교육)멘토링/강연": "proj",
    "(런웨이)IR/투자유치": "proj",
}
CAT_PRIORITY = ["fund", "cert", "proj"]
EXCLUDED_TYPE = "(그로스하이)내부프로젝트"

# ── 프로젝트 상태 → (stage, badge) ───────────────────────────────────────
STATUS_MAP = {
    "(시작전)미배정": (0, "wait"),
    "(시작전)배정": (0, "wait"),
    "(진행중)자료요청": (1, "run"),
    "(진행중)검토중": (1, "run"),
    "(진행중)작업중": (2, "run"),
    "(진행중)내부완료": (2, "run"),
    "(내부완료)회신대기": (2, "run"),
    "(내부완료)결과대기": (3, "run"),
    "(프로젝트완료)사후관리": (5, "ok"),
    "(프로젝트완료)최종종료": (5, "ok"),
    "(미완료)최종보류": (-1, "no"),
}

# stage 인덱스로 참조한다. index.html 의 LABELS 와 같은 표를 유지할 것.
STAGE_LABELS = {
    "fund": ["검토", "서류", "작성", "평가", "결과"],
    "cert": ["진단", "서류", "접수", "심사", "취득"],
    "proj": ["착수", "분석", "작성", "검토", "완료"],
}

# 공지 파서 — 이 밖의 블록(table·image·embed·child_database)은 조용히 건너뛴다.
NOTICE_ITEM_TYPES = {"to_do", "bulleted_list_item", "numbered_list_item", "paragraph", "toggle"}
NOTICE_HEADING_TYPES = {"heading_1", "heading_2", "heading_3"}
NOTICE_PASSTHRU_TYPES = {"column_list", "column", "synced_block"}

ALWAYS = "9999-12-31"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

KST = timezone(timedelta(hours=9))


# ══════════════════════════════════════════════════════════════════════════
# 시각 — 테스트에서 갈아끼울 수 있게 한 곳에 모은다
# ══════════════════════════════════════════════════════════════════════════

def now_kst() -> datetime:
    return datetime.now(KST)


def today_kst() -> date:
    return now_kst().date()


# ══════════════════════════════════════════════════════════════════════════
# 로그
# ══════════════════════════════════════════════════════════════════════════

WARNINGS: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    WARNINGS.append(msg)
    print(f"  ⚠ {msg}", flush=True)


class ClientFailure(Exception):
    """이 클라이언트만 건너뛴다. 나머지는 계속 빌드한다."""


# ══════════════════════════════════════════════════════════════════════════
# 노션 REST — SDK 를 쓰지 않고 requests 로 직접 호출한다
# ══════════════════════════════════════════════════════════════════════════

class Notion:
    def __init__(self, token: str):
        self.s = requests.Session()
        self.s.headers.update({
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        })
        self._last = 0.0

    def _throttle(self) -> None:
        gap = time.monotonic() - self._last
        if gap < NOTION_MIN_INTERVAL:
            time.sleep(NOTION_MIN_INTERVAL - gap)
        self._last = time.monotonic()

    def _request(self, method: str, path: str, **kw) -> dict:
        url = f"{NOTION_API}{path}"
        for attempt in range(MAX_RETRIES + 1):
            self._throttle()
            try:
                r = self.s.request(method, url, timeout=60, **kw)
            except requests.RequestException as e:
                if attempt >= MAX_RETRIES:
                    raise ClientFailure(f"노션 요청 실패 {path}: {e}") from e
                time.sleep(2 ** attempt)
                continue

            if r.status_code == 200:
                return r.json()

            # 404 는 재시도해도 달라지지 않는다. 즉시 실패.
            if r.status_code == 404:
                raise ClientFailure(f"노션 404: {path}")

            if r.status_code == 429 or r.status_code >= 500:
                if attempt >= MAX_RETRIES:
                    raise ClientFailure(f"노션 {r.status_code}: {path} (재시도 소진)")
                wait = float(r.headers.get("Retry-After", 0) or 0) or (2 ** attempt)
                time.sleep(wait)
                continue

            raise ClientFailure(f"노션 {r.status_code}: {path} — {r.text[:200]}")
        raise ClientFailure(f"노션 요청 실패: {path}")

    def get(self, path: str) -> dict:
        return self._request("GET", path)

    def post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, json=body)

    def query_all(self, database_id: str, body: dict | None = None) -> list[dict]:
        out: list[dict] = []
        cursor = None
        while True:
            payload = dict(body or {})
            payload["page_size"] = 100
            if cursor:
                payload["start_cursor"] = cursor
            j = self.post(f"/databases/{database_id}/query", payload)
            out.extend(j.get("results", []))
            if not j.get("has_more"):
                return out
            cursor = j.get("next_cursor")

    def children(self, block_id: str) -> list[dict]:
        out: list[dict] = []
        cursor = None
        while True:
            q = "?page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
            j = self.get(f"/blocks/{block_id}/children{q}")
            out.extend(j.get("results", []))
            if not j.get("has_more"):
                return out
            cursor = j.get("next_cursor")


# ══════════════════════════════════════════════════════════════════════════
# 노션 속성 읽기 도우미 — 비어 있는 값이 많으므로 전부 optional 로 다룬다
# ══════════════════════════════════════════════════════════════════════════

def p_text(props: dict, name: str) -> str:
    p = props.get(name) or {}
    runs = p.get("rich_text") or p.get("title") or []
    return "".join(r.get("plain_text", "") for r in runs).strip()


def p_multi(props: dict, name: str) -> list[str]:
    p = props.get(name) or {}
    return [o.get("name", "") for o in (p.get("multi_select") or []) if o.get("name")]


def p_select(props: dict, name: str) -> str | None:
    p = props.get(name) or {}
    sel = p.get("select")
    return sel.get("name") if sel else None


def p_relation(props: dict, name: str) -> list[str]:
    p = props.get(name) or {}
    return [x.get("id") for x in (p.get("relation") or []) if x.get("id")]


def p_people(props: dict, name: str) -> str | None:
    p = props.get(name) or {}
    names = [u.get("name") for u in (p.get("people") or []) if u.get("name")]
    return ", ".join(names) or None


def p_url(props: dict, name: str) -> str | None:
    p = props.get(name) or {}
    return p.get("url") or None


def p_date(props: dict, name: str) -> dict:
    p = props.get(name) or {}
    return p.get("date") or {}


def first_title_prop(props: dict) -> str:
    """공지 제목 속성명은 「상세내용」이다. 이름이 아니라 title 타입으로 찾는다."""
    for v in props.values():
        if v.get("type") == "title":
            return "".join(r.get("plain_text", "") for r in (v.get("title") or [])).strip()
    return ""


def nn(v):
    """빈 문자열은 null 로. 화면에서 조건부 렌더가 걸려 있다."""
    return v if v else None


# ══════════════════════════════════════════════════════════════════════════
# §3 클라이언트 목록
# ══════════════════════════════════════════════════════════════════════════

def fetch_clients(nt: Notion, only: str | None) -> list[dict]:
    rows = nt.query_all(SHARE_DB_ID, {
        "filter": {"property": "페이지 유형",
                   "multi_select": {"contains": CLIENT_PAGE_TYPE}},
    })
    log(f"클라이언트 후보 {len(rows)}건")

    clients = []
    for row in rows:
        props = row.get("properties", {})
        name = p_text(props, "페이지명")
        slug = p_text(props, "슬러그")
        company_ids = p_relation(props, "기업 DB")

        if not slug:
            warn(f"슬러그 없음 — 건너뜀: {name!r}")
            continue
        if not company_ids:
            warn(f"기업 DB 릴레이션 없음 — 건너뜀: {name!r} ({slug})")
            continue
        if only and slug != only:
            continue

        clients.append({
            "page_id": row.get("id"),
            "page_name": name,
            "slug": slug,
            "company_page_id": company_ids[0],
            "manager": p_people(props, "담당자"),
            "notice_db_url": p_url(props, "공지 DB"),
            "password": p_text(props, "비밀번호_해시"),   # 이름과 달리 평문이다
            "tags": p_multi(props, "업종"),
            "icon": row.get("icon"),
        })
    return clients


# ══════════════════════════════════════════════════════════════════════════
# §4 기업 정보
# ══════════════════════════════════════════════════════════════════════════

def fetch_company(nt: Notion, company_page_id: str) -> dict:
    page = nt.get(f"/pages/{company_page_id}")
    props = page.get("properties", {})
    return {
        "name": nn(p_text(props, "기업명")),
        "biz": nn(p_text(props, "사업내용")),
        "address": nn(p_text(props, "주소")),
        "founded": nn(p_text(props, "설립연월")),
        "industry": p_multi(props, "업종분류"),
        "certs": p_multi(props, "인증ㅣ특허"),
    }


# ══════════════════════════════════════════════════════════════════════════
# §5·§6 프로젝트
# ══════════════════════════════════════════════════════════════════════════

# 접두어는 전부 뗀다. 하나만 떼면 [웰스앤헬스][위프코리아]… 에서 남의 회사명이 남는다.
PREFIX_RE = re.compile(r"^(\[[^\]]*\])+\s*")
LOG_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\((.+)\)$", re.DOTALL)


def pick_cat(types: list[str], title: str) -> str:
    cats = {CAT_BY_TYPE[t] for t in types if t in CAT_BY_TYPE}
    unknown = [t for t in types if t not in CAT_BY_TYPE]
    if unknown and not cats:
        warn(f"매핑에 없는 프로젝트 유형 {unknown} — proj 로 처리: {title!r}")
    for c in CAT_PRIORITY:
        if c in cats:
            return c
    return "proj"


def stage_label(cat: str, stage: int) -> str:
    labels = STAGE_LABELS.get(cat, STAGE_LABELS["proj"])
    if stage < 0:
        return "보류"
    if stage >= len(labels):
        return "종료"
    return labels[stage]


def split_log(raw: str) -> tuple[str, str]:
    """최신로그 `YYYY-MM-DD(내용)` 을 날짜/내용으로 가른다. 내용은 가공하지 않는다."""
    if not raw:
        return "", ""
    m = LOG_RE.match(raw.strip())
    if not m:
        return "", raw.strip()
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", m.group(4)


def fetch_projects(nt: Notion, company_page_id: str) -> list[dict]:
    rows = nt.query_all(PROJECT_DB_ID, {
        "filter": {"property": "고객사 정보",
                   "relation": {"contains": company_page_id}},
    })

    out = []
    for row in rows:
        props = row.get("properties", {})
        raw_title = p_text(props, "프로젝트명")
        types = p_multi(props, "프로젝트 유형")

        if EXCLUDED_TYPE in types:
            continue

        title = PREFIX_RE.sub("", raw_title).strip()
        joint = raw_title.count("[") >= 2

        status = p_select(props, "프로젝트 상태")
        if status in STATUS_MAP:
            stage, badge = STATUS_MAP[status]
        else:
            stage, badge = 0, "wait"
            warn(f"매핑에 없는 프로젝트 상태 {status!r} — (0, wait) 로 처리: {title!r}")

        cat = pick_cat(types, title)
        period = p_date(props, "진행기간")
        start = (period.get("start") or "")[:10]
        end = (period.get("end") or "")[:10]
        if end == ALWAYS:
            end = "상시"

        log_date, log_text = split_log(p_text(props, "최신로그"))

        out.append({
            "title": title,
            "cat": cat,
            "joint": joint,
            "stage": stage,
            "stage_label": stage_label(cat, stage),
            "badge": badge,
            "start": start,
            "end": end,
            "log_date": log_date,
            "log_text": log_text,
        })

    # 시작일 내림차순 — 노션 화면 순서와 같게 최근 건이 위로 온다
    out.sort(key=lambda r: (r["start"] or "", r["title"]), reverse=True)
    return out


# ══════════════════════════════════════════════════════════════════════════
# §7 공지사항
# ══════════════════════════════════════════════════════════════════════════

HEX32_RE = re.compile(r"[0-9a-fA-F]{32}")


def notice_db_id(url: str | None) -> str | None:
    """공지 DB URL 에서 32자 hex 를 뽑아 UUID 로 만든다. `?v=` 는 잘라내고 경로만 본다."""
    if not url:
        return None
    path = urllib.parse.urlsplit(url).path
    hits = HEX32_RE.findall(path)          # `제목-{hex}` 형태도 걸린다
    if not hits:
        return None
    h = hits[-1].lower()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}


def esc(s: str) -> str:
    return "".join(ESCAPES.get(c, c) for c in s)


TRAIL_RE = re.compile(r"[\s:：]+$")


def trim_runs(runs: list[dict]) -> list[dict]:
    """후행 콜론·공백을 뗀다. 「벤처기업(~10월) :」 → 「벤처기업(~10월)」"""
    out = [dict(r) for r in runs]
    while out:
        t = TRAIL_RE.sub("", out[-1].get("plain_text", ""))
        out[-1]["plain_text"] = t
        if t:
            break
        out.pop()
    return out


def runs_to_html(runs: list[dict]) -> str:
    """rich_text 를 서식 태그가 붙은 HTML 로. 노션 텍스트는 반드시 이스케이프한다."""
    parts = []
    for r in runs:
        t = r.get("plain_text", "")
        if not t:
            continue
        a = r.get("annotations") or {}
        h = esc(t)
        if a.get("code"):
            h = f"<code>{h}</code>"
        if a.get("underline"):
            h = f"<u>{h}</u>"
        if a.get("strikethrough"):
            h = f"<s>{h}</s>"
        if a.get("bold"):
            h = f"<b>{h}</b>"
        parts.append(h)
    return "".join(parts)


def block_runs(block: dict) -> list[dict]:
    body = block.get(block.get("type"))
    if not isinstance(body, dict):
        return []
    return body.get("rich_text") or []


def make_item(b: dict, children: list[dict]) -> dict | None:
    """빈 항목은 버린다. 단 하위 항목이 있으면 부모는 살린다."""
    html = runs_to_html(trim_runs(block_runs(b)))
    if not html and not children:
        return None
    t = b.get("type")
    checked = (b.get(t) or {}).get("checked") if t == "to_do" else None
    return {"checked": checked, "html": html, "children": children}


def notice_items(nt: Notion, blocks: list[dict]) -> list[dict]:
    """항목 트리를 만든다. 사람이 자유롭게 쓰는 글이라 구조를 강하게 가정하지 않는다."""
    items: list[dict] = []
    for b in blocks:
        t = b.get("type")

        if t in NOTICE_PASSTHRU_TYPES:
            if b.get("has_children"):
                items.extend(notice_items(nt, nt.children(b["id"])))
            continue

        if t == "callout":
            kids = nt.children(b["id"]) if b.get("has_children") else []
            # heading 을 품은 callout 은 껍데기다. 안쪽을 그대로 편다.
            if any(k.get("type") in NOTICE_HEADING_TYPES for k in kids):
                items.extend(notice_items(nt, kids))
            else:
                it = make_item(b, notice_items(nt, kids))
                if it:
                    items.append(it)
            continue

        if t not in NOTICE_ITEM_TYPES:
            continue   # 화이트리스트 밖 — 자식도 조회하지 않는다

        children = notice_items(nt, nt.children(b["id"])) if b.get("has_children") else []
        it = make_item(b, children)
        if it:
            items.append(it)
    return items


def fetch_notice(nt: Notion, url: str | None) -> dict | None:
    db_id = notice_db_id(url)
    if not db_id:
        warn("공지 DB URL 이 없거나 ID 를 뽑지 못했습니다 — notice 생략")
        return None

    try:
        rows = nt.query_all(db_id, {"sorts": [{"property": "일자", "direction": "descending"}]})
    except ClientFailure as e:
        warn(f"공지 DB 조회 실패 — notice 생략: {e}")
        return None
    if not rows:
        warn("공지 DB 가 비어 있습니다 — notice 생략")
        return None

    page = rows[0]
    props = page.get("properties", {})
    title = first_title_prop(props)
    when = (p_date(props, "일자").get("start") or "")[:10]

    try:
        blocks = nt.children(page["id"])
    except ClientFailure as e:
        warn(f"공지 본문 조회 실패 — notice 생략: {e}")
        return None

    # 최상위를 훑으며 heading 마다 섹션을 연다.
    sections: list[dict] = []
    cur: dict | None = None

    def flush_into(dest_items: list[dict]) -> None:
        nonlocal cur
        if cur is None:
            cur = {"heading": None, "items": []}
            sections.append(cur)
        cur["items"].extend(dest_items)

    def walk(bs: list[dict]) -> None:
        nonlocal cur
        for b in bs:
            t = b.get("type")
            if t in NOTICE_PASSTHRU_TYPES:
                if b.get("has_children"):
                    walk(nt.children(b["id"]))
                continue
            if t == "callout":
                kids = nt.children(b["id"]) if b.get("has_children") else []
                if any(k.get("type") in NOTICE_HEADING_TYPES for k in kids):
                    walk(kids)                       # 껍데기 — 안쪽을 그대로 편다
                    continue
                it = make_item(b, notice_items(nt, kids))
                if it:
                    flush_into([it])
                continue
            if t in NOTICE_HEADING_TYPES:
                heading = "".join(r.get("plain_text", "") for r in block_runs(b)).strip()
                cur = {"heading": heading, "items": []}   # 📌 는 그대로 둔다
                sections.append(cur)
                continue
            if t in NOTICE_ITEM_TYPES:
                flush_into(notice_items(nt, [b]))
                continue
            # 그 밖(table·image·embed·child_database)은 조용히 건너뛴다

    try:
        walk(blocks)
    except ClientFailure as e:
        warn(f"공지 파싱 실패 — notice 생략: {e}")
        return None

    if not sections:
        warn("공지 본문에서 읽을 내용이 없습니다 — notice 생략")
        return None

    return {"title": title or "공지사항", "date": when, "sections": sections}


# ══════════════════════════════════════════════════════════════════════════
# §8 로고
# ══════════════════════════════════════════════════════════════════════════

CT_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
    "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
}


def fetch_logo(icon: dict | None, slug: str, dry_run: bool) -> tuple[str | None, str | None]:
    """(logo, logo_emoji) 를 준다.

    file URL 은 1시간 만료다. 그대로 JSON 에 넣으면 깨지므로 반드시 내려받아 저장한다.
    """
    if not icon:
        return None, None

    kind = icon.get("type")
    if kind == "emoji":
        return None, icon.get("emoji")

    # file / external / custom_emoji 모두 URL 을 준다. custom_emoji 는 노션 워크스페이스
    # 커스텀 이모지로, 사실상 이미지다 — 이모지 글리프가 아니라 내려받아 쓴다.
    url = ((icon.get(kind) or {}).get("url")) if kind else None
    if not url:
        warn(f"페이지 아이콘 형식을 알 수 없습니다 ({kind!r}) — logo 생략")
        return None, None

    try:
        # 노션 세션과 분리한다. 인증 헤더가 S3 로 나가면 안 된다.
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        ct = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        ext = CT_EXT.get(ct)
        if not ext:
            ext = Path(urllib.parse.urlsplit(url).path).suffix.lower() or ".png"
            if ext not in CT_EXT.values():
                ext = ".png"
        rel = f"logo/{slug}{ext}"
        if not dry_run:
            atomic_write_bytes(ROOT / rel, r.content)
        return rel, None
    except Exception as e:                      # noqa: BLE001 — 로고 실패로 빌드를 죽이지 않는다
        warn(f"로고 내려받기 실패 — logo=null: {type(e).__name__}")
        return None, None


# ══════════════════════════════════════════════════════════════════════════
# §9 추천 지원사업
# ══════════════════════════════════════════════════════════════════════════

_policy_cache: dict[str, dict] | None = None


def policy_index() -> dict[str, dict]:
    """빌드당 한 번만 받는다. slug 필드는 없다 — file 에서 .html 을 뗀 값이 조인 키다."""
    global _policy_cache
    if _policy_cache is not None:
        return _policy_cache
    try:
        r = requests.get(POLICY_DATA_URL, timeout=60)
        r.raise_for_status()
        programs = r.json().get("programs") or []
    except Exception as e:                      # noqa: BLE001
        warn(f"정책정보 메타 내려받기 실패: {type(e).__name__}")
        _policy_cache = {}
        return _policy_cache

    idx = {}
    for p in programs:
        f = p.get("file")
        if f:
            idx[f[:-5] if f.endswith(".html") else f] = p
    _policy_cache = idx
    log(f"정책정보 메타 {len(idx)}건")
    return idx


def unwrap_firestore(v: dict):
    """Firestore REST 응답은 타입 태그로 감싸여 있다."""
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "booleanValue" in v:
        return v["booleanValue"]
    if "nullValue" in v:
        return None
    if "arrayValue" in v:
        return [unwrap_firestore(x) for x in (v["arrayValue"].get("values") or [])]
    if "mapValue" in v:
        return {k: unwrap_firestore(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    return None


def dday(target: date, today: date) -> str:
    n = (target - today).days
    if n > 0:
        return f"D-{n}"
    if n == 0:
        return "D-DAY"
    return f"D+{-n}"


def fetch_recommend(company_name: str, include_expired: bool) -> list[dict]:
    if not company_name:
        warn("기업명이 없어 재생목록을 조회하지 못했습니다 — recommend=[]")
        return []

    url = PLAYLIST_URL.format(name=urllib.parse.quote(company_name, safe=""))
    try:
        # 노션 세션과 분리한다. 인증 헤더가 외부 호스트로 나가면 안 된다.
        r = requests.get(url, timeout=60)
        if r.status_code == 404:
            log("  재생목록 없음 — recommend=[]")
            return []
        r.raise_for_status()
        fields = r.json().get("fields") or {}
        doc = {k: unwrap_firestore(v) for k, v in fields.items()}
    except Exception as e:                      # noqa: BLE001
        warn(f"Firestore 재생목록 조회 실패 — recommend=[]: {type(e).__name__}")
        return []

    entries = [x for x in (doc.get("items") or []) if isinstance(x, dict) and x.get("slug")]
    if not entries:
        return []

    idx = policy_index()
    today = today_kst()
    out = []
    for order, ent in enumerate(entries):
        slug = ent["slug"]
        prog = idx.get(slug)
        if not prog:
            warn(f"정책정보에 없는 재생목록 항목 — 건너뜀: {slug}")
            continue

        raw_deadline = (prog.get("deadline_iso") or "")[:10]
        expired = False
        dd = ""
        if DATE_RE.match(raw_deadline):
            d = date.fromisoformat(raw_deadline)
            expired = d < today
            dd = dday(d, today)

        if expired and not include_expired:
            continue

        out.append({
            "slug": slug,
            "title": prog.get("title") or "",
            "org": None,                        # data-full.json 에 기관명이 없다. 추정하지 않는다.
            "deadline": raw_deadline or None,
            "dday": dd,
            "expired": expired,
            # 「컨소시엄당 최대 10억(정부 50%)」 같은 문자열이라 정규식으로 자르지 않는다.
            "amount": (prog.get("meta") or {}).get("지원") or None,
            "review_url": POLICY_BASE_URL + prog["file"] if prog.get("file") else None,
            "_order": order,
        })

    # 안 지난 건 먼저 오름차순, 지난 건 뒤로 최신 마감 순.
    def key(o):
        d = o["deadline"] or "9999-12-31"
        return (1, -_date_ord(d), o["_order"]) if o["expired"] else (0, _date_ord(d), o["_order"])

    out.sort(key=key)
    for o in out:
        o.pop("_order")
    return out


def _date_ord(s: str) -> int:
    try:
        return date.fromisoformat(s).toordinal()
    except ValueError:
        return date.max.toordinal()


# ══════════════════════════════════════════════════════════════════════════
# §10 일정
# ══════════════════════════════════════════════════════════════════════════

MAX_EVENTS = 12
MAX_CAL_EVENTS = 10
CAL_HORIZON_DAYS = 90


def build_events(progress: list[dict], recommend: list[dict],
                 company_name: str, include_expired: bool) -> list[dict]:
    today = today_kst()
    events: list[dict] = []

    # 원천 1 — 프로젝트 종료 예정일. 이미 끝난 건(ok·no)은 뺀다.
    for r in progress:
        end = r.get("end") or ""
        if not DATE_RE.match(end):          # 「상시」·빈 값은 일정에 올리지 않는다
            continue
        if r.get("badge") in ("ok", "no"):
            continue
        d = date.fromisoformat(end)
        events.append({
            "date": end,
            "title": r["title"],
            "kind": "project",
            "meta": r.get("stage_label") or "",
            "dday": dday(d, today),
            "past": d < today,
        })

    # 원천 2 — 추천 사업 마감일
    for o in recommend:
        dl = o.get("deadline") or ""
        if not DATE_RE.match(dl):
            continue
        d = date.fromisoformat(dl)
        events.append({
            "date": dl,
            "title": o.get("title") or "",
            "kind": "deadline",
            "meta": o.get("amount") or "마감",
            "dday": dday(d, today),
            "past": d < today,
        })

    # 원천 3 (선택) — 캘린더
    events.extend(fetch_calendar(company_name, today))

    if not include_expired:
        events = [e for e in events if not e["past"]]

    # 동명 프로젝트가 있다. (제목, 날짜) 짝으로 중복을 본다.
    seen = set()
    uniq = []
    for e in sorted(events, key=lambda x: (x["date"], x["kind"], x["title"])):
        k = (e["kind"], e["title"], e["date"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(e)
    return uniq[:MAX_EVENTS]


def fetch_calendar(company_name: str, today: date) -> list[dict]:
    """CALENDAR_ICS_URL 이 설정돼 있을 때만. 미설정이면 조용히 건너뛴다."""
    url = os.environ.get("CALENDAR_ICS_URL", "").strip()
    if not url or not company_name:
        return []
    try:
        from icalendar import Calendar
    except ImportError:
        warn("icalendar 미설치 — 캘린더 생략")
        return []

    try:
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        cal = Calendar.from_ical(r.content)
    except Exception as e:                      # noqa: BLE001
        warn(f"캘린더 조회 실패 — 생략: {type(e).__name__}")
        return []

    prefix = f"[{company_name}]"
    horizon = today + timedelta(days=CAL_HORIZON_DAYS)
    out = []
    for ev in cal.walk("VEVENT"):
        summary = str(ev.get("SUMMARY") or "")
        if not summary.startswith(prefix):
            continue
        dt = ev.get("DTSTART")
        if not dt:
            continue
        v = dt.dt
        d = v.date() if isinstance(v, datetime) else v
        if not isinstance(d, date) or d < today or d > horizon:
            continue
        out.append({
            "date": d.isoformat(),
            "title": summary[len(prefix):].strip(),   # 접두어는 표시할 때 뗀다
            "kind": "project",
            "meta": "일정",
            "dday": dday(d, today),
            "past": False,
        })
    out.sort(key=lambda e: e["date"])
    return out[:MAX_CAL_EVENTS]


# ══════════════════════════════════════════════════════════════════════════
# 소통 내역 — 다우오피스 메일
#
# 헤더만 읽는다. 제목이 곧 내용이라 본문·첨부는 건드리지 않는다.
# 본문을 안 읽으면 사내 논의가 새어 나갈 일도, 요약이 틀릴 일도 없다.
#
# 읽기 규칙은 check_imap.py 와 같다.
#   EXAMINE 으로 연다 (SELECT 금지). 읽음 처리되면 안 된다
#   BODY.PEEK[HEADER.FIELDS ...] 만 쓴다. STORE·EXPUNGE·DELETE 는 쓰지 않는다
# ══════════════════════════════════════════════════════════════════════════

# 사람이 손으로 분류해둔 고객사 폴더를 그대로 쓴다. 발신 도메인 추측보다 정확하다.
TALKS_FOLDER_PREFIX = "Inbox.고객사."
TALKS_DAYS = 90
TALKS_FETCH_MAX = 30            # 폴더에서 읽어올 최근 메일 수
TALKS_OUTPUT_MAX = 20           # JSON 에 담을 수
OWN_MAIL_DOMAIN = "growthhigh.co.kr"

# 메일함 뒤쪽에서 이만큼만 훑는다. 도착순이라 최근 건은 항상 이 구간에 있다.
TALKS_SCAN_MAX = 300

IMAP_PORT = 993
HEADER_SPEC = "(BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])"

# 「RE: FW: 회신: 제목」 처럼 겹쳐 붙은 것까지 한 번에 뗀다. Re[2]: 형태도 처리.
REPLY_PREFIX_RE = re.compile(
    r"^(?:\s*(?:RE|FW|FWD|회신|전달)\s*(?:\[\d+\])?\s*:\s*)+", re.IGNORECASE)

# LIST 응답에서 메일함 원본 이름(수정 UTF-7)을 뽑는다.
# SELECT 에는 이 원본을 그대로 쓴다 — imaplib 은 명령을 ASCII 로만 보내므로
# 디코딩한 한글 이름을 넘기면 UnicodeEncodeError 가 난다.
LIST_LINE_RE = re.compile(r'^\([^)]*\)\s+(?:"[^"]*"|NIL)\s+(?P<name>.+)$')


def list_raw_name(line) -> str | None:
    if isinstance(line, tuple):
        line = b" ".join(x for x in line if isinstance(x, bytes))
    if not isinstance(line, bytes):
        return None
    m = LIST_LINE_RE.match(line.decode("ascii", "replace").strip())
    if not m:
        return None
    name = m.group("name").strip()
    return name[1:-1] if name.startswith('"') and name.endswith('"') else name


def nfc(s: str) -> str:
    """한글은 조합형/완성형이 섞여 들어온다. 비교 전에 정규화한다."""
    return unicodedata.normalize("NFC", s).strip()


def strip_reply_prefix(title: str) -> str:
    """RE:·FW:·회신:·전달: 만 뗀다. 나머지는 원문 그대로 둔다."""
    return REPLY_PREFIX_RE.sub("", title).strip() or title.strip()


def fetch_talks(company_name: str) -> list[dict]:
    """고객사 폴더에서 최근 90일치 메일 헤더를 읽는다.

    폴더명이 정확히 일치하는 것만 쓴다. 없으면 빈 목록 + 경고 — 추측하지 않는다.
    """
    host = os.environ.get("IMAP_HOST", "").strip()
    user = os.environ.get("IMAP_USER", "").strip()
    password = os.environ.get("IMAP_PASS", "")
    if not (host and user and password):
        warn("IMAP 접속 정보가 없습니다 — talks=[]")
        return []
    if not company_name:
        warn("기업명이 없어 메일 폴더를 찾지 못했습니다 — talks=[]")
        return []

    try:
        M = imaplib.IMAP4_SSL(host, IMAP_PORT, timeout=60)
    except Exception as e:                       # noqa: BLE001
        warn(f"메일 서버 연결 실패 — talks=[]: {type(e).__name__}")
        return []

    try:
        M.login(user, password)

        typ, data = M.list()
        target = nfc(TALKS_FOLDER_PREFIX + company_name)
        folder = next((raw for raw in (list_raw_name(x) for x in data or [])
                       if raw and nfc(imap_utf7_decode(raw)) == target), None)
        if folder is None:
            warn(f"메일 폴더 없음 — talks=[]: {TALKS_FOLDER_PREFIX}{company_name}")
            return []

        # EXAMINE = 읽기 전용. SELECT 로 열면 읽음 처리가 될 수 있다.
        typ, data = M.select(f'"{folder}"', readonly=True)
        if typ != "OK":
            warn(f"메일 폴더를 열지 못했습니다 — talks=[]: {folder}")
            return []
        exists = int(data[0])
        if exists == 0:
            log("  메일 0건")
            return []

        # 서버 SEARCH 를 쓰지 않는다. 다우오피스는 날짜 조건에 대해 매칭 개수만큼
        # 1번부터 세어서 돌려주고(SEARCH ALL 은 0건), 그대로 믿으면 가장 오래된
        # 메일이 최신인 것처럼 화면에 뜬다. 헤더를 받아 여기서 직접 거른다.
        start = max(1, exists - TALKS_SCAN_MAX + 1)
        typ, data = M.fetch(f"{start}:{exists}", HEADER_SPEC)
        if typ != "OK":
            warn(f"메일 헤더를 읽지 못했습니다 — talks=[]: {folder}")
            return []

        cutoff = (today_kst() - timedelta(days=TALKS_DAYS)).isoformat()
        mails, undated = [], 0
        for item in data:
            if not isinstance(item, tuple):
                continue
            mail = parse_header(item[1])
            if not mail:
                continue
            if not mail["date"]:
                undated += 1
                continue
            if mail["date"] >= cutoff:
                mails.append(mail)
        if undated:
            warn(f"날짜를 읽을 수 없는 메일 {undated}건 — 제외했습니다")

        mails.sort(key=lambda m: m["date"], reverse=True)
        log(f"  메일 {len(mails)}건 (전체 {exists}통 중 최근 {TALKS_DAYS}일, 헤더만)")
        return mails[:TALKS_FETCH_MAX]
    except Exception as e:                       # noqa: BLE001
        warn(f"메일 수집 실패 — talks=[]: {type(e).__name__}: {e}")
        return []
    finally:
        for close in (M.close, M.logout):
            try:
                close()
            except Exception:                    # noqa: BLE001
                pass


def parse_header(raw: bytes) -> dict | None:
    msg = message_from_bytes(raw)

    when = ""
    raw_date = msg.get("Date")
    if raw_date:
        try:
            when = parsedate_to_datetime(raw_date).astimezone(KST).date().isoformat()
        except Exception:                        # noqa: BLE001 — 깨진 Date 헤더가 있다
            pass

    sender = parseaddr(msg.get("From") or "")[1].lower()
    return {
        "date": when,
        "channel": "메일",
        "title": strip_reply_prefix(decode_mime(msg.get("Subject"))) or "(제목 없음)",
        # 우리 도메인에서 나갔으면 「보냄」. Inbox 아래에도 발신 사본이 섞여 있다.
        "direction": "보냄" if sender.endswith("@" + OWN_MAIL_DOMAIN) else "받음",
        "_message_id": (msg.get("Message-ID") or "").strip(),
    }


# ── 게이트 ───────────────────────────────────────────────────────────────

def visible_talks(talks: list[dict]) -> list[dict]:
    """화면(JSON)에 내보낼 것만 고른다.

    지금은 노션 소통 DB 가 없어 전부 통과시킨다.
    DB 가 생기면 「상태 = 공개」인 것만 남기도록 이 함수만 고치면 된다.
    """
    return talks


def build_talks(company_name: str) -> list[dict]:
    talks = fetch_talks(company_name)
    if not talks:
        return []

    push_talks_to_notion(talks, company_name)

    talks = visible_talks(talks)
    talks.sort(key=lambda t: t["date"] or "", reverse=True)
    return [{k: v for k, v in t.items() if not k.startswith("_")}
            for t in talks[:TALKS_OUTPUT_MAX]]


# ── 노션 소통 DB (선택) ──────────────────────────────────────────────────
# DB 는 아직 없다. NOTION_TALKS_DB_ID 가 있으면 쓰고, 없으면 건너뛴다.
# 스키마를 모르므로 DB 속성을 먼저 읽어 실제로 있는 것만 채운다.

TALK_FIELDS = {                     # 우리 값 → (속성명 후보, 노션 타입)
    "title":     (["제목", "내용", "소통 내역"], "title"),
    "date":      (["일자", "날짜"], "date"),
    "channel":   (["채널", "경로"], "select"),
    "direction": (["방향"], "select"),
    "company":   (["기업명", "고객사"], "rich_text"),
    "status":    (["상태"], "select"),
}
TALK_MSGID_NAMES = ["Message-ID", "메시지 ID", "message_id"]
TALK_INITIAL_STATUS = "검토대기"


def push_talks_to_notion(talks: list[dict], company_name: str) -> None:
    db_id = os.environ.get("NOTION_TALKS_DB_ID", "").strip()
    if not db_id:
        return

    nt = Notion(os.environ.get("NOTION_TOKEN", "").strip())
    try:
        schema = nt.get(f"/databases/{db_id}").get("properties", {})
    except ClientFailure as e:
        warn(f"소통 DB 스키마를 읽지 못했습니다 — 노션 쓰기 생략: {e}")
        return

    def pick(names, want_type):
        return next((n for n in names
                     if (schema.get(n) or {}).get("type") == want_type), None)

    # Message-ID 로 중복을 막는다. 저장할 데가 없으면 쓰지 않는다.
    msgid_prop = pick(TALK_MSGID_NAMES, "rich_text")
    if not msgid_prop:
        warn("소통 DB 에 Message-ID(rich_text) 속성이 없습니다 — "
             "중복을 막을 수 없어 노션 쓰기를 건너뜁니다")
        return

    mapping = {k: pick(names, typ) for k, (names, typ) in TALK_FIELDS.items()}
    added = skipped = 0
    for t in talks:
        mid = t.get("_message_id") or ""
        if not mid:
            warn(f"Message-ID 없는 메일 — 노션 쓰기 건너뜀: {t['title'][:30]}")
            continue
        try:
            hit = nt.post(f"/databases/{db_id}/query", {
                "page_size": 1,
                "filter": {"property": msgid_prop, "rich_text": {"equals": mid}},
            })
            if hit.get("results"):
                skipped += 1
                continue

            props = {msgid_prop: {"rich_text": [{"text": {"content": mid[:2000]}}]}}
            values = {**t, "company": company_name, "status": TALK_INITIAL_STATUS}
            for key, prop in mapping.items():
                val = values.get(key)
                if not prop or not val:
                    continue
                kind = schema[prop]["type"]
                if kind == "title":
                    props[prop] = {"title": [{"text": {"content": str(val)[:2000]}}]}
                elif kind == "rich_text":
                    props[prop] = {"rich_text": [{"text": {"content": str(val)[:2000]}}]}
                elif kind == "select":
                    props[prop] = {"select": {"name": str(val)}}
                elif kind == "date":
                    props[prop] = {"date": {"start": str(val)}}

            nt.post("/pages", {"parent": {"database_id": db_id}, "properties": props})
            added += 1
        except ClientFailure as e:
            warn(f"소통 DB 쓰기 실패 — 건너뜁니다: {e}")

    log(f"  소통 DB: {added}건 추가 · {skipped}건 중복 건너뜀")


# ══════════════════════════════════════════════════════════════════════════
# §11 암호화 · 출력
# ══════════════════════════════════════════════════════════════════════════

def encrypt(payload: dict, password: str) -> dict:
    """브라우저 WebCrypto 가 읽는 봉투를 만든다. index.html 이 이 형식을 기대한다."""
    plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if not password:
        return {"v": 1, "enc": False, "data": payload}

    salt = os.urandom(16)
    iv = os.urandom(12)
    key = PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt,
                     iterations=PBKDF2_ITERATIONS).derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, plaintext, None)     # ct||tag — WebCrypto 와 같은 배치
    return {
        "v": 1, "enc": True,
        "kdf": "PBKDF2-SHA256", "iterations": PBKDF2_ITERATIONS,
        "cipher": "AES-GCM",
        "salt": base64.b64encode(salt).decode(),
        "iv": base64.b64encode(iv).decode(),
        "data": base64.b64encode(ct).decode(),
    }


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """임시 파일에 쓴 뒤 교체한다. 도중에 죽어도 기존 파일이 안 깨진다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def write_client_page(slug: str, dry_run: bool) -> None:
    """루트 index.html 을 복사하고 __SLUG__ 한 줄만 주입한다. 그 밖은 원본과 같아야 한다."""
    src = ROOT / "index.html"
    if not src.exists():
        warn("루트 index.html 이 없어 클라이언트 페이지를 만들지 못했습니다")
        return

    raw = src.read_text(encoding="utf-8", newline="")     # 줄바꿈을 원본 그대로 둔다
    nl = "\r\n" if "\r\n" in raw else "\n"
    inject = f'<script>window.__SLUG__="{slug}";window.__BASE__="../";</script>'

    anchor = f"</main>{nl}{nl}<script>"
    if anchor not in raw:
        warn("index.html 에서 주입 지점을 찾지 못했습니다 — 클라이언트 페이지 생략")
        return
    out = raw.replace(anchor, f"</main>{nl}{nl}{inject}{nl}<script>", 1)

    if not dry_run:
        atomic_write_bytes(ROOT / slug / "index.html", out.encode("utf-8"))


# ══════════════════════════════════════════════════════════════════════════
# 빌드
# ══════════════════════════════════════════════════════════════════════════

def build_one(nt: Notion, client: dict, include_expired: bool, dry_run: bool) -> dict:
    slug = client["slug"]
    log(f"\n▶ {slug}")

    company = fetch_company(nt, client["company_page_id"])
    name = company.get("name") or client["page_name"]
    log(f"  기업명: {name}")

    progress = fetch_projects(nt, client["company_page_id"])
    log(f"  프로젝트 {len(progress)}건")

    notice = fetch_notice(nt, client.get("notice_db_url"))
    if notice:
        log(f"  공지: {notice['title']} ({notice['date']}) — 섹션 {len(notice['sections'])}")

    logo, logo_emoji = fetch_logo(client.get("icon"), slug, dry_run)

    recommend = fetch_recommend(name, include_expired)
    log(f"  추천 지원사업 {len(recommend)}건")

    talks = build_talks(name)
    log(f"  소통 내역 {len(talks)}건")

    events = build_events(progress, recommend, name, include_expired)
    log(f"  일정 {len(events)}건")

    next_ev = next((e for e in events if not e["past"]), None)
    kpi = {
        "running": sum(1 for r in progress if r["badge"] == "run"),
        "done": sum(1 for r in progress if r["badge"] == "ok"),
        "certs": sum(1 for r in progress if r["cat"] == "cert" and r["badge"] == "ok"),
        "next": next_ev,
    }

    payload = {
        "generated_at": now_kst().replace(microsecond=0).isoformat(),
        "company": {
            "name": name,
            "biz": company.get("biz"),
            "tags": client.get("tags") or [],
            "manager": client.get("manager"),
            "logo": logo,
            "logo_emoji": logo_emoji,
            "address": company.get("address"),
            "founded": company.get("founded"),
            "industry": company.get("industry") or [],
            "certs": company.get("certs") or [],
        },
        "notice": notice,
        "progress": progress,
        "recommend": recommend,
        "talks": talks,
        "events": events,
        "kpi": kpi,
    }

    password = client.get("password") or ""
    envelope = encrypt(payload, password)
    blob = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    if dry_run:
        log(f"  (dry-run) c/{slug}.enc {len(blob):,}B · enc={envelope.get('enc')}")
    else:
        atomic_write_bytes(ROOT / "c" / f"{slug}.enc", blob)
        write_client_page(slug, dry_run)
        log(f"  c/{slug}.enc {len(blob):,}B · {slug}/index.html")

    return {"slug": slug, "encrypted": bool(password), "payload": payload}


def build(only: str | None, include_expired: bool, dry_run: bool) -> int:
    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not token:
        log("NOTION_TOKEN 이 없습니다. .env 를 확인하세요 (.env.example 참고).")
        return 2

    nt = Notion(token)
    clients = fetch_clients(nt, only)
    if only and not clients:
        log(f"슬러그 {only!r} 에 해당하는 클라이언트를 찾지 못했습니다.")
        return 2
    log(f"빌드 대상 {len(clients)}건: {', '.join(c['slug'] for c in clients)}")

    failed, plaintext = [], []
    for c in clients:
        try:
            res = build_one(nt, c, include_expired, dry_run)
            if not res["encrypted"]:
                plaintext.append(res["slug"])
        except ClientFailure as e:
            warn(f"[{c['slug']}] 실패 — 건너뜁니다: {e}")
            failed.append(c["slug"])
        except Exception as e:                  # noqa: BLE001 — 한 곳이 죽어도 나머지는 계속
            warn(f"[{c['slug']}] 예기치 못한 실패 — 건너뜁니다: {type(e).__name__}: {e}")
            failed.append(c["slug"])

    log("")
    if WARNINGS:
        log(f"경고 {len(WARNINGS)}건")
    if plaintext:
        log("⚠ 배포하지 마세요 — 아래 클라이언트는 암호화되지 않은 평문입니다.")
        for s in plaintext:
            log(f"    · {s}")
    if failed:
        log(f"실패 {len(failed)}건: {', '.join(failed)}")
        return 1
    log("완료")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="클라이언트 페이지 빌더")
    ap.add_argument("--client", metavar="슬러그", default=None, help="한 곳만 빌드")
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않는다")
    ap.add_argument("--no-include-expired", action="store_true",
                    help="마감이 지난 추천 사업·일정을 제외한다")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    include_expired = INCLUDE_EXPIRED and not args.no_include_expired
    return build(args.client, include_expired, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
