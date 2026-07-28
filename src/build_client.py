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
import quopri
import re
import sys
import time
import unicodedata
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from email import message_from_bytes
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from html import unescape as html_unescape
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

# 좌측 「자료」 그룹의 가이드북. 클라이언트 공통이라 노션이 아니라 여기 둔다.
GUIDEBOOK_URL = "https://yuncommon.notion.site/f12815d712b982d3af19812af6f50cbe"

PLAYLIST_URL = ("https://firestore.googleapis.com/v1/projects/growthhigh-playlist"
                "/databases/(default)/documents/playlists/{name}")
POLICY_DATA_URL = "https://bluep2000-hub.github.io/growthhigh-policy/data-full.json"
POLICY_BASE_URL = "https://bluep2000-hub.github.io/growthhigh-policy/"

# 마감이 지난 추천 사업·일정도 내보낼지. 운영 전환 시 False.
INCLUDE_EXPIRED = False

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

def fetch_clients(nt: Notion, only: str | None) -> tuple[list[dict], set[str]]:
    """빌드 대상과 함께 「우리 클라이언트 이름」 전부를 돌려준다.

    이름 목록은 보낸메일함에서 남의 건을 가려낼 때 쓴다. 슬러그가 없어
    빌드하지 않는 행의 이름도 필요하다 — 그 회사 메일이 옆 클라이언트
    페이지로 새는 것을 막아야 하기 때문이다.
    """
    rows = nt.query_all(SHARE_DB_ID, {
        "filter": {"property": "페이지 유형",
                   "multi_select": {"contains": CLIENT_PAGE_TYPE}},
    })
    log(f"클라이언트 후보 {len(rows)}건")

    clients = []
    known_names: set[str] = set()
    for row in rows:
        props = row.get("properties", {})
        name = p_text(props, "페이지명")
        slug = p_text(props, "슬러그")
        company_ids = p_relation(props, "기업 DB")
        known_names |= client_name_tokens(name)

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
            "drive_url": p_url(props, "드라이브 URL"),
            "bizplan_url": p_url(props, "사업계획서 URL"),
            "password": p_text(props, "비밀번호_해시"),   # 이름과 달리 평문이다
            "tags": p_multi(props, "업종"),
            "icon": row.get("icon"),
        })
    return clients, known_names


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
            # 「확보금액」은 number 가 아니라 rich_text 다. 금액만이 아니라
            # 「하이서울기업 인증서」 같은 산출물도 들어 있어 원문을 그대로 넘긴다.
            "amount": p_text(props, "확보금액").strip() or None,
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
        if a.get("italic"):
            h = f"<i>{h}</i>"
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
# 소통 내역
#
# 메일은 본문까지 읽어 노션 소통 DB 에 「공개」로 앉히고, 그대로 화면에 나간다.
# 고객사와 오간 메일 아카이빙이라 우리가 검토할 대상이 아니고, 본문도 원문 그대로다.
# 감출 것이 있으면 담당자가 「보류」로 바꾼다 — 읽을 때 그것만 뺀다.
#
# 통화록·요약은 이 스크립트가 만들지 않는다 (클로드 코워크가 노션에 기록한다).
# 이 스크립트는 IMAP 을 노션에 쓰고, 노션을 읽는다.
#
# 메일 읽기 규칙은 check_imap.py 와 같다.
#   EXAMINE 으로 연다 (SELECT 금지). 읽음 처리되면 안 된다
#   BODY.PEEK 만 쓴다. STORE·EXPUNGE·DELETE 는 쓰지 않는다
#   첨부는 BODYSTRUCTURE 로 파일명만 읽고 내려받지 않는다
# ══════════════════════════════════════════════════════════════════════════

# 소통 내역 DB. database_id 라우트 + 2022-06-28 로 접근된다 (확인 완료).
TALKS_DB_ID = "3aa815d7-12b9-80f9-ae45-e9f2bebcd9de"
# 「검토대기」는 지금 아무것도 쓰지 않지만 옵션은 남겨둔다.
# 통화·미팅 AI 요약이 붙으면 그때는 사람이 거를 대상이 생긴다.
TALK_STATUS_NEW = "검토대기"
TALK_STATUS_PUBLIC = "공개"
TALK_STATUS_HIDDEN = "보류"     # 담당자가 의도적으로 숨긴 것. 읽기에서 뺀다
TALK_CHANNEL_MAIL = "메일"
# 이 채널들은 회의록이 페이지 본문에 들어간다 — 속성만 읽으면 안건 한 줄뿐이다
TALK_CHANNELS_WITH_MINUTES = {"미팅", "유선"}

# 사람이 손으로 분류해둔 고객사 폴더를 그대로 쓴다. 발신 도메인 추측보다 정확하다.
TALKS_FOLDER_PREFIX = "Inbox.고객사."
TALKS_DAYS = 90
TALKS_FETCH_MAX = 30            # 폴더에서 읽어올 최근 메일 수
TALKS_OUTPUT_MAX = 60           # JSON 에 담을 수. 90일치 받음+보냄이 다 들어가는 값
OWN_MAIL_DOMAIN = "growthhigh.co.kr"

# 메일함 뒤쪽에서 이만큼만 훑는다. 도착순이라 최근 건은 항상 이 구간에 있다.
TALKS_SCAN_MAX = 300

BODY_FETCH_MAX = 200_000        # 텍스트 파트를 이 바이트까지만 받는다
BODY_MAX_CHARS = 2000           # 노션 rich_text 한계이자 화면에 싣는 한계
BODY_MIN_CHARS = 10             # 이보다 짧으면 제목만 있는 메일로 본다
BODY_TRUNC_MARK = "…(이하 생략)"

IMAP_PORT = 993
HEADER_SPEC = "(BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])"

# 보낸메일함 이름은 서버마다 다르다. LIST 결과에서 이 이름들을 찾는다.
# 이 서버(다우오피스)의 실제 이름은 Sent — check_imap.py 로 확인했다.
SENT_FOLDER_NAMES = frozenset({
    "sent", "sent items", "sent messages", "sentmail",
    "보낸메일함", "보낸편지함", "보낸 메일함",
})

# 공용 메일 도메인. 여기 속하면 도메인만으로는 어느 클라이언트인지 특정할 수
# 없으므로, 로컬파트까지 붙인 전체 주소로만 맞춘다.
PUBLIC_MAIL_DOMAINS = frozenset({
    "naver.com", "gmail.com", "googlemail.com", "daum.net", "hanmail.net",
    "nate.com", "kakao.com", "hotmail.com", "outlook.com", "live.com",
    "yahoo.com", "yahoo.co.kr", "icloud.com", "me.com",
    "empas.com", "dreamwiz.com", "korea.com",
})

# 「RE: FW: 회신: 제목」 처럼 겹쳐 붙은 것까지 한 번에 뗀다. Re[2]: 형태도 처리.
REPLY_PREFIX_RE = re.compile(
    r"^(?:\s*(?:RE|FW|FWD|회신|전달)\s*(?:\[\d+\])?\s*:\s*)+", re.IGNORECASE)

# 이 줄부터 아래는 인용문이다.
# 「보낸 사람」은 아웃룩이 띄어쓰기를 넣는다. 붙여 쓴 형태만 보면 인용이 안 잘린다.
QUOTE_CUT_RES = [
    re.compile(r"^\s*-{2,}\s*Original Message\s*-{2,}", re.IGNORECASE),
    re.compile(r"^\s*-{2,}\s*원본\s*메일\s*-{2,}"),
    re.compile(r"^\s*_{10,}\s*$"),                          # 아웃룩 인용 구분선
    re.compile(r"^\s*보낸\s*사람\s*:"),
    re.compile(r"^\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일.*작성\s*:"),   # 지메일 한국어
]

# 이 줄부터 아래는 서명·면책이다. 인용과 달리 되살리지 않는다.
SIG_CUT_RES = [
    re.compile(r"^\s*본\s*메일은"),
    re.compile(r"^\s*이\s*메일은"),
    re.compile(r"^\s*Confidential", re.IGNORECASE),
]

BODY_CUT_RES = QUOTE_CUT_RES + SIG_CUT_RES

# 인용부 머리에 붙는 헤더 줄. 전달 메일을 되살릴 때 이 블록을 걷어낸다.
QUOTE_HEADER_RE = re.compile(
    r"^\s*(?:보낸\s*사람|보낸\s*날짜|받는\s*사람|참조|숨은\s*참조|제목|"
    r"From|Sent|To|Cc|Bcc|Subject|Date)\s*:", re.IGNORECASE)

# 메일 클라이언트가 text/plain 에 남기는 찌꺼기. 사람이 읽을 내용이 아니다.
CID_RE = re.compile(r"\[cid:[^\]]*\]")
ANGLE_URL_RE = re.compile(r"<(?:https?|mailto):[^>\s]*>")
PIXEL_LINE_RE = re.compile(r"^\s*\[https?://[^\]]*\]\s*$")

TAG_RE = re.compile(r"<[^>]+>")
BR_RE = re.compile(r"(?i)<\s*(?:br\s*/?|/p|/div|/tr)\s*>")
SPACE_RE = re.compile(r"[ \t ]+")

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


# ── BODYSTRUCTURE 파서 ───────────────────────────────────────────────────
# 첨부를 내려받지 않고 텍스트 파트만 받으려면 구조를 먼저 알아야 한다.
# 표준 파서가 없어 S-식을 직접 훑는다.

def bs_tokens(s: bytes):
    i, n = 0, len(s)
    while i < n:
        c = s[i:i + 1]
        if c in b" \t\r\n":
            i += 1
        elif c in b"()":
            yield c.decode(), None
            i += 1
        elif c == b'"':
            j, out = i + 1, bytearray()
            while j < n and s[j:j + 1] != b'"':
                if s[j:j + 1] == b"\\":
                    out += s[j + 1:j + 2]
                    j += 2
                else:
                    out += s[j:j + 1]
                    j += 1
            yield "v", out.decode("utf-8", "replace")
            i = j + 1
        elif c == b"{":                       # 리터럴 {n}\r\n<바이트>
            j = s.find(b"}", i)
            if j < 0:
                return
            ln = int(s[i + 1:j] or 0)
            start = j + 3
            yield "v", s[start:start + ln].decode("utf-8", "replace")
            i = start + ln
        else:
            j = i
            while j < n and s[j:j + 1] not in b" \t\r\n()":
                j += 1
            tok = s[i:j].decode("ascii", "replace")
            yield "v", (None if tok.upper() == "NIL" else tok)
            i = j


def bs_parse(tokens) -> list:
    root: list = []
    stack = [root]
    for kind, val in tokens:
        if kind == "(":
            node: list = []
            stack[-1].append(node)
            stack.append(node)
        elif kind == ")":
            if len(stack) > 1:
                stack.pop()
        else:
            stack[-1].append(val)
    return root


def bs_find(node):
    """FETCH 응답 어딘가에 있는 BODYSTRUCTURE 본체를 찾는다."""
    if not isinstance(node, list):
        return None
    for i, x in enumerate(node):
        if isinstance(x, str) and x.upper() == "BODYSTRUCTURE" and i + 1 < len(node):
            return node[i + 1]
        found = bs_find(x)
        if found is not None:
            return found
    return None


def bs_parts(node, prefix=""):
    """(파트번호, 노드) 를 RFC 3501 번호 체계로 훑는다."""
    if not isinstance(node, list) or not node:
        return
    if isinstance(node[0], list):                 # multipart
        idx = 1
        for child in node:
            if not isinstance(child, list):
                break
            yield from bs_parts(child, f"{prefix}{idx}.")
            idx += 1
    else:
        yield prefix[:-1] or "1", node


def bs_pairs(lst) -> dict:
    if not isinstance(lst, list):
        return {}
    return {str(lst[i]).lower(): lst[i + 1]
            for i in range(0, len(lst) - 1, 2) if isinstance(lst[i], str)}


def bs_disposition(node) -> tuple[str | None, dict]:
    for x in node:
        if (isinstance(x, list) and x and isinstance(x[0], str)
                and x[0].lower() in ("attachment", "inline")):
            return x[0].lower(), bs_pairs(x[1] if len(x) > 1 else [])
    return None, {}


# ── 본문 정리 ────────────────────────────────────────────────────────────

def decode_part(raw: bytes, encoding: str | None, charset: str | None) -> str:
    """Content-Transfer-Encoding 을 풀고 charset 으로 디코딩한다 (EUC-KR 다수)."""
    enc = (encoding or "").lower()
    if enc == "base64":
        b = b"".join(raw.split())
        b = b[:len(b) - len(b) % 4]              # 잘린 스트림도 풀리게 맞춘다
        try:
            raw = base64.b64decode(b)
        except Exception:                        # noqa: BLE001
            return ""
    elif enc == "quoted-printable":
        try:
            raw = quopri.decodestring(raw)
        except Exception:                        # noqa: BLE001
            return ""
    try:
        return raw.decode(charset or "utf-8", "replace")
    except LookupError:                          # 알 수 없는 charset 이름
        return raw.decode("utf-8", "replace")


def cut_at_quote(lines: list[str]) -> tuple[list[str], list[str]]:
    """(인용·서명 위, 그 아래) 로 가른다. 없으면 아래는 빈 목록."""
    for i, ln in enumerate(lines):
        if any(r.match(ln) for r in BODY_CUT_RES):
            return lines[:i], lines[i:]
    return lines, []


def strip_quote_header(lines: list[str]) -> list[str]:
    """인용 구분선과 「보낸 사람:」류 헤더 줄을 걷어내고 내용부터 돌려준다."""
    i = 0
    while i < len(lines):
        ln = lines[i]
        if (not ln.strip() or QUOTE_HEADER_RE.match(ln)
                or any(r.match(ln) for r in QUOTE_CUT_RES)):
            i += 1
            continue
        break
    return lines[i:]


def tidy(lines: list[str]) -> str:
    lines = [SPACE_RE.sub(" ", ln).strip() for ln in lines
             if not ln.lstrip().startswith(">")            # 인용 줄 제거
             and not PIXEL_LINE_RE.match(ln)]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def clean_body(text: str, is_html: bool) -> str:
    """인용문·서명을 걷어내고 사람이 읽을 만한 본문만 남긴다."""
    if is_html:
        text = BR_RE.sub("\n", text)             # 줄바꿈 태그는 개행으로 살린다
        text = TAG_RE.sub("", text)
        text = html_unescape(text)

    # 첨부 참조·추적 픽셀·꺾쇠 링크는 본문이 아니라 메일 클라이언트 흔적이다
    text = CID_RE.sub("", text)
    text = ANGLE_URL_RE.sub("", text)

    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    above, below = cut_at_quote(lines)
    body = tidy(above)
    if body or not below:
        return body

    # 새로 쓴 문장이 없는 전달 메일이다. 인용부가 곧 본문이므로 되살린다.
    # 헤더 블록을 걷어내고, 전달의 전달이면 한 겹 더 자른다.
    rest, _ = cut_at_quote(strip_quote_header(below))
    return tidy(rest)


def compose_body(text: str, attachments: list[str]) -> str:
    """정리한 본문 + 첨부 파일명 한 줄. 노션 rich_text 한계에 맞춰 자른다."""
    # 너무 짧으면 제목이 곧 내용인 메일이다. 본문은 비운다.
    if len(text) < BODY_MIN_CHARS:
        text = ""

    tail = f"첨부: {', '.join(attachments)}" if attachments else ""
    room = BODY_MAX_CHARS - (len(tail) + 1 if tail else 0)

    if len(text) > room:
        text = text[:max(0, room - len(BODY_TRUNC_MARK))].rstrip() + BODY_TRUNC_MARK

    parts = [p for p in (text, tail) if p]
    return "\n".join(parts)[:BODY_MAX_CHARS]


# ── IMAP: 헤더 + 본문 수집 ───────────────────────────────────────────────

def scan_folder(M: imaplib.IMAP4_SSL, folder: str) -> tuple[list[dict], int]:
    """폴더 뒤쪽을 훑어 최근 TALKS_DAYS 일치 헤더를 돌려준다. 본문은 읽지 않는다.

    서버 SEARCH 를 쓰지 않는다. 다우오피스는 날짜 조건에 대해 매칭 개수만큼
    1번부터 세어서 돌려주고(SEARCH ALL 은 0건), 그대로 믿으면 가장 오래된
    메일이 최신인 것처럼 화면에 뜬다. 헤더를 받아 여기서 직접 거른다.

    건수를 여기서 자르지 않는다 — 보낸메일함은 걸러낸 뒤에 잘라야 한다.
    """
    # EXAMINE = 읽기 전용. SELECT 로 열면 읽음 처리가 될 수 있다.
    typ, data = M.select(f'"{folder}"', readonly=True)
    if typ != "OK":
        warn(f"메일 폴더를 열지 못했습니다: {folder}")
        return [], 0
    exists = int(data[0])
    if exists == 0:
        return [], 0

    start = max(1, exists - TALKS_SCAN_MAX + 1)
    typ, data = M.fetch(f"{start}:{exists}", HEADER_SPEC)
    if typ != "OK":
        warn(f"메일 헤더를 읽지 못했습니다: {folder}")
        return [], exists

    cutoff = (today_kst() - timedelta(days=TALKS_DAYS)).isoformat()
    mails, undated = [], 0
    for item in data:
        if not isinstance(item, tuple):
            continue
        mail = parse_header(item[1])
        if not mail:
            continue
        try:
            mail["seq"] = item[0].split()[0].decode()
        except Exception:                        # noqa: BLE001
            continue
        if not mail["date"]:
            undated += 1
            continue
        if mail["date"] >= cutoff:
            mails.append(mail)
    if undated:
        warn(f"날짜를 읽을 수 없는 메일 {undated}건 — 제외했습니다")

    mails.sort(key=lambda m: m["date"], reverse=True)
    return mails, exists


def read_bodies(M: imaplib.IMAP4_SSL, mails: list[dict]) -> None:
    """폴더가 열려 있는 동안 불러야 한다 — seq 는 폴더마다 다르다.
    한 건이 죽어도 나머지는 계속."""
    for m in mails:
        try:
            text, attachments = read_body(M, m["seq"])
        except Exception as e:                   # noqa: BLE001
            warn(f"본문 파싱 실패 — 요약 비움: {m['title'][:28]} ({type(e).__name__})")
            text, attachments = "", []
        m["body"] = compose_body(text, attachments)


# ── 보낸메일함: 수신자로 클라이언트를 가려낸다 ───────────────────────────
#
# 받은 메일은 사람이 분류해둔 폴더가 곧 정답이었다. 보낸메일함에는 모든
# 클라이언트 메일이 섞여 있어 그런 단서가 없다. 그래서 이미 수집한 받은
# 메일의 발신자에서 상대방 주소를 뽑아, 그것을 수신자와 맞춘다.

# 제목 말머리의 대괄호. 「[리마인드][위프코리아]…」 처럼 겹쳐 붙는다.
BRACKET_RE = re.compile(r"[\[【]([^\]】]{1,40})[\]】]")
# 「웰스앤헬스(위프코리아) 클라이언트페이지」 → {웰스앤헬스, 위프코리아}
CLIENT_NAME_STRIP_RE = re.compile(r"\s*클라이언트\s*페이지\s*$")
CLIENT_NAME_SPLIT_RE = re.compile(r"[()/·,\[\]]")


def name_key(s: str) -> str:
    """이름 비교용 키. 공백과 조합형 차이를 없앤다."""
    return nfc(s).replace(" ", "")


def client_name_tokens(page_name: str) -> set[str]:
    """공유페이지 이름에서 기업명을 뽑는다. fetch_clients 가 목록을 만들 때 쓴다."""
    base = CLIENT_NAME_STRIP_RE.sub("", nfc(page_name))
    return {name_key(p) for p in CLIENT_NAME_SPLIT_RE.split(base) if name_key(p)}


def subject_companies(title: str, known: set[str]) -> set[str]:
    """제목 말머리 대괄호에서 「우리 클라이언트 이름」만 추린다.

    [리마인드]·[기술이전] 같은 말머리는 기업명이 아니므로 걸러진다.
    [웰스앤헬스/위프코리아] 처럼 한 괄호에 둘이 든 것도 나눠 본다.
    """
    out = set()
    for token in BRACKET_RE.findall(title or ""):
        for part in CLIENT_NAME_SPLIT_RE.split(token):
            key = name_key(part)
            if key and key in known:
                out.add(key)
    return out


def own_addresses() -> set[str]:
    """우리 쪽 주소. 담당자 개인 메일처럼 우리 도메인이 아닌 것도 있어
    .env 의 OWN_MAIL_EXTRA 로 받는다. 이 주소들은 「상대방」이 아니다."""
    raw = os.environ.get("OWN_MAIL_EXTRA", "")
    own = {a.strip().lower() for a in re.split(r"[,;\s]+", raw) if a.strip()}
    own.add(os.environ.get("IMAP_USER", "").strip().lower())
    return {a for a in own if "@" in a}


def client_match_keys(received: list[dict]) -> tuple[set[str], set[str]]:
    """받은 메일의 발신자에서 (도메인, 전체주소) 두 벌의 기준을 만든다.

    공용 도메인은 도메인만으로 클라이언트를 특정할 수 없으므로 전체 주소로만
    맞춘다. 우리 도메인과 담당자 개인 주소는 어느 쪽에도 넣지 않는다 —
    넣으면 사내 메일과 다른 클라이언트 건이 전부 걸린다.
    """
    own = own_addresses()
    domains: set[str] = set()
    addresses: set[str] = set()
    for m in received:
        addr = (m.get("sender") or "").strip().lower()
        if "@" not in addr or addr in own:
            continue
        dom = addr.rsplit("@", 1)[1]
        if not dom or dom == OWN_MAIL_DOMAIN:
            continue
        if dom in PUBLIC_MAIL_DOMAINS:
            addresses.add(addr)
        else:
            domains.add(dom)
    return domains, addresses


def match_recipients(mail: dict, domains: set[str], addresses: set[str]) -> list[str]:
    """수신자 중 기준에 걸린 주소를 돌려준다. 하나도 없으면 이 클라이언트 건이 아니다."""
    hits = []
    for addr in mail.get("recipients") or []:
        dom = addr.rsplit("@", 1)[1] if "@" in addr else ""
        if addr in addresses or (dom and dom not in PUBLIC_MAIL_DOMAINS and dom in domains):
            hits.append(addr)
    return hits


def find_sent_folder(list_data) -> str | None:
    """LIST 결과에서 보낸메일함을 찾는다. 못 찾으면 None — 추측하지 않는다."""
    for raw in (list_raw_name(x) for x in list_data or []):
        if not raw:
            continue
        name = nfc(imap_utf7_decode(raw))
        leaf = re.split(r"[./]", name)[-1].strip().lower()
        if leaf in SENT_FOLDER_NAMES or name.strip().lower() in SENT_FOLDER_NAMES:
            return raw
    return None


def sent_belongs(mail: dict, company_key: str, known: set[str],
                 domains: set[str], addresses: set[str]) -> list[str]:
    """이 보낸 메일이 해당 클라이언트 건인지 판정하고 근거를 돌려준다.

    제목 말머리에 기업명이 있으면 그것이 우선이다 — 담당자가 여러 회사를
    겸하는 경우가 있어 도메인보다 제목이 정확하다. 「[웰스앤헬스]…」 는
    수신자가 이 클라이언트여도 저쪽 건이다.
    말머리가 없을 때만 수신자 도메인으로 맞춘다. 둘 다 아니면 넣지 않는다.
    """
    # 수신자가 전부 사내면 클라이언트와 오간 메일이 아니다. 제목이 무엇이든 뺀다.
    # 「어느 클라이언트인가」와 별개의 조건이라 말머리보다 먼저 본다.
    if not [a for a in (mail.get("recipients") or [])
            if not a.endswith("@" + OWN_MAIL_DOMAIN)]:
        return []

    tagged = subject_companies(mail.get("title") or "", known)
    if tagged:
        return [f"제목 [{company_key}]"] if company_key in tagged else []
    return [f"수신자 {a}" for a in match_recipients(mail, domains, addresses)]


def fetch_sent(M: imaplib.IMAP4_SSL, list_data, received: list[dict],
               company_name: str, known_names: set[str]) -> list[dict]:
    """보낸메일함에서 이 클라이언트와 오간 것만 골라 온다."""
    domains, addresses = client_match_keys(received)
    if not (domains or addresses):
        # 맞출 기준이 없다. 추측해서 넣느니 넣지 않는다.
        log("  상대방 도메인을 못 찾아 보낸메일함은 건너뜁니다")
        return []

    folder = find_sent_folder(list_data)
    if folder is None:
        warn("보낸메일함을 찾지 못했습니다 — 보낸 메일 수집 생략")
        return []

    company_key = name_key(company_name)
    known = known_names | {company_key}
    seen = {m["message_id"] for m in received if m.get("message_id")}
    cand, _ = scan_folder(M, folder)

    out, by_title = [], 0
    for m in cand:
        if m.get("message_id") and m["message_id"] in seen:
            continue                             # 고객사 폴더에 사본이 이미 있다
        why = sent_belongs(m, company_key, known, domains, addresses)
        if not why:
            continue
        m["direction"] = "보냄"                   # 보낸메일함에 있으면 우리가 보낸 것이다
        m["matched"] = why
        by_title += why[0].startswith("제목")
        out.append(m)

    out = out[:TALKS_FETCH_MAX]
    log(f"  보낸메일 {len(out)}건 (보낸메일함 최근 {TALKS_DAYS}일 {len(cand)}건 중"
        f" · 제목 {by_title}건 / 수신자 {len(out) - by_title}건)")
    read_bodies(M, out)
    return out


def fetch_mails(company_name: str, known_names: set[str]) -> list[dict]:
    """고객사 폴더 + 보낸메일함에서 최근 90일치 메일을 읽는다.

    폴더명이 정확히 일치하는 것만 쓴다. 없으면 빈 목록 + 경고 — 추측하지 않는다.
    보낸 것은 폴더로 갈릴 수 없어 받은 메일에서 뽑은 주소로 수신자를 맞춘다.
    """
    host = os.environ.get("IMAP_HOST", "").strip()
    user = os.environ.get("IMAP_USER", "").strip()
    password = os.environ.get("IMAP_PASS", "")
    if not (host and user and password):
        warn("IMAP 접속 정보가 없습니다 — 메일 수집 생략")
        return []
    if not company_name:
        warn("기업명이 없어 메일 폴더를 찾지 못했습니다 — 메일 수집 생략")
        return []

    try:
        M = imaplib.IMAP4_SSL(host, IMAP_PORT, timeout=60)
    except Exception as e:                       # noqa: BLE001
        warn(f"메일 서버 연결 실패 — 메일 수집 생략: {type(e).__name__}")
        return []

    try:
        M.login(user, password)

        typ, list_data = M.list()
        target = nfc(TALKS_FOLDER_PREFIX + company_name)
        folder = next((raw for raw in (list_raw_name(x) for x in list_data or [])
                       if raw and nfc(imap_utf7_decode(raw)) == target), None)
        if folder is None:
            warn(f"메일 폴더 없음 — 메일 수집 생략: {TALKS_FOLDER_PREFIX}{company_name}")
            return []

        received, exists = scan_folder(M, folder)
        received = received[:TALKS_FETCH_MAX]
        if not received:
            # 받은 메일이 없으면 보낸 것을 맞출 기준도 없다.
            log("  메일 0건")
            return []
        log(f"  메일 {len(received)}건 (전체 {exists}통 중 최근 {TALKS_DAYS}일)")
        read_bodies(M, received)

        mails = received + fetch_sent(M, list_data, received, company_name, known_names)
        mails.sort(key=lambda m: m["date"], reverse=True)
        return mails
    except Exception as e:                       # noqa: BLE001
        warn(f"메일 수집 실패: {type(e).__name__}: {e}")
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
    # To·Cc 는 보낸메일함에서 클라이언트를 가려낼 유일한 단서다.
    recipients = [a.strip().lower()
                  for _, a in getaddresses((msg.get_all("To") or []) +
                                           (msg.get_all("Cc") or []))
                  if a and "@" in a]
    return {
        "date": when,
        "title": strip_reply_prefix(decode_mime(msg.get("Subject"))) or "(제목 없음)",
        # 우리 도메인에서 나갔으면 「보냄」. Inbox 아래에도 발신 사본이 섞여 있다.
        "direction": "보냄" if sender.endswith("@" + OWN_MAIL_DOMAIN) else "받음",
        "message_id": (msg.get("Message-ID") or "").strip(),
        "sender": sender,
        "recipients": recipients,
    }


def read_body(M: imaplib.IMAP4_SSL, seq: str) -> tuple[str, list[str]]:
    """텍스트 파트만 받고, 첨부는 파일명만 읽는다."""
    typ, data = M.fetch(seq, "(BODYSTRUCTURE)")
    if typ != "OK" or not data:
        return "", []
    line = data[0] if isinstance(data[0], bytes) else b" ".join(
        x for x in data[0] if isinstance(x, bytes))
    struct = bs_find(bs_parse(bs_tokens(line)))
    if struct is None:
        return "", []

    attachments: list[str] = []
    text_part = None                             # (파트번호, 노드, subtype)
    for part_no, node in bs_parts(struct):
        kind = (node[0] or "").lower() if node else ""
        sub = (node[1] or "").lower() if len(node) > 1 else ""
        params = bs_pairs(node[2]) if len(node) > 2 else {}
        disp, dparams = bs_disposition(node[3:] if len(node) > 3 else [])
        filename = dparams.get("filename") or params.get("name")

        if disp == "attachment" or (filename and kind != "text"):
            attachments.append(decode_mime(filename) if filename else f"(이름없음).{sub}")
            continue
        # text/plain 우선, 없으면 text/html
        if kind == "text" and (text_part is None or
                               (sub == "plain" and text_part[2] != "plain")):
            text_part = (part_no, node, sub)

    if text_part is None:
        return "", attachments

    part_no, node, sub = text_part
    size = node[6] if len(node) > 6 and isinstance(node[6], str) and node[6].isdigit() else None
    spec = f"BODY.PEEK[{part_no}]"
    if size and int(size) > BODY_FETCH_MAX:
        spec += f"<0.{BODY_FETCH_MAX}>"
    typ, data = M.fetch(seq, f"({spec})")
    if typ != "OK" or not data or not isinstance(data[0], tuple):
        return "", attachments

    params = bs_pairs(node[2]) if len(node) > 2 else {}
    text = decode_part(data[0][1],
                       node[5] if len(node) > 5 else None,
                       params.get("charset"))
    return clean_body(text, sub == "html"), attachments


# ── 노션 소통 DB: 쓰기 ───────────────────────────────────────────────────

def sync_mails_to_notion(nt: Notion, client_page_id: str, mails: list[dict]) -> None:
    """새 메일만 「검토대기」로 넣는다. 화면에는 아직 나가지 않는다."""
    # 기존 Message-ID 를 한 번에 받아 메모리에서 대조한다. 건마다 조회하지 않는다.
    try:
        rows = nt.query_all(TALKS_DB_ID, {
            "filter": {"property": "클라이언트",
                       "relation": {"contains": client_page_id}},
        })
    except ClientFailure as e:
        warn(f"소통 DB 기존 항목 조회 실패 — 노션 쓰기 생략: {e}")
        return
    seen = {p_text(r.get("properties", {}), "Message-ID") for r in rows}
    seen.discard("")

    added = skipped = 0
    for m in mails:
        mid = m["message_id"]
        if not mid:
            warn(f"Message-ID 없는 메일 — 노션 쓰기 건너뜀: {m['title'][:30]}")
            continue
        if mid in seen:
            skipped += 1
            continue

        body = m.get("body") or ""
        props = {
            "제목": {"title": [{"text": {"content": m["title"][:2000]}}]},
            "클라이언트": {"relation": [{"id": client_page_id}]},
            "채널": {"select": {"name": TALK_CHANNEL_MAIL}},
            "방향": {"select": {"name": m["direction"]}},
            "요약": {"rich_text": ([{"text": {"content": body}}] if body else [])},
            "Message-ID": {"rich_text": [{"text": {"content": mid[:2000]}}]},
            "상태": {"select": {"name": TALK_STATUS_PUBLIC}},
        }
        if m["date"]:
            props["일자"] = {"date": {"start": m["date"]}}

        try:
            nt.post("/pages", {"parent": {"database_id": TALKS_DB_ID},
                               "properties": props})
            seen.add(mid)                        # 같은 실행 안의 중복도 막는다
            added += 1
        except ClientFailure as e:
            warn(f"소통 DB 쓰기 실패 — 건너뜁니다: {e}")

    log(f"  소통 DB: {added}건 추가(공개) · {skipped}건 중복 건너뜀")


# ── 회의록 본문: 페이지 블록 → HTML ──────────────────────────────────────
# 미팅·유선 건은 회의록 전체가 페이지 본문에 들어간다. 「요약」 속성에는
# 안건 목록 한 줄뿐이라 속성만 읽으면 화면에 아무것도 나오지 않는다.
# 서식 변환은 공지 파서의 runs_to_html / block_runs 를 그대로 쓴다.

TALK_BODY_MAX_DEPTH = 6          # 폭주 방지. 실제 회의록은 2~3단이다
TALK_HEADING_TAG = {"heading_1": "h2", "heading_2": "h3", "heading_3": "h4"}
TALK_LIST_TAG = {"bulleted_list_item": "ul", "numbered_list_item": "ol"}


def talk_table_html(nt: Notion, block: dict) -> str:
    """회의록의 Action Items 표. table 의 자식은 table_row 뿐이다."""
    meta = block.get("table") or {}
    try:
        rows = nt.children(block["id"])
    except ClientFailure as e:
        warn(f"회의록 표 조회 실패 — 표 생략: {e}")
        return ""

    cells_of = lambda r: ((r.get("table_row") or {}).get("cells") or [])
    header = bool(meta.get("has_column_header"))
    row_header = bool(meta.get("has_row_header"))

    out = []
    for i, r in enumerate(rows):
        if r.get("type") != "table_row":
            continue
        head = header and i == 0
        tds = []
        for j, cell in enumerate(cells_of(r)):
            tag = "th" if head or (row_header and j == 0) else "td"
            tds.append(f"<{tag}>{runs_to_html(cell)}</{tag}>")
        if not tds:
            continue
        out.append(("<thead><tr>" + "".join(tds) + "</tr></thead>") if head
                   else ("<tr>" + "".join(tds) + "</tr>"))
    if not out:
        return ""
    if out and out[0].startswith("<thead>"):
        return f"<table>{out[0]}<tbody>{''.join(out[1:])}</tbody></table>"
    return f"<table><tbody>{''.join(out)}</tbody></table>"


def talk_body_html(nt: Notion, blocks: list[dict], depth: int = 0) -> str:
    """지원 블록만 HTML 로 옮긴다. 그 밖은 조용히 건너뛴다."""
    if depth > TALK_BODY_MAX_DEPTH:
        return ""

    parts: list[str] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        t = b.get("type")

        # 연속된 같은 종류의 리스트는 하나의 ul/ol 로 묶는다
        if t in TALK_LIST_TAG:
            tag = TALK_LIST_TAG[t]
            lis = []
            while i < len(blocks) and blocks[i].get("type") == t:
                li = blocks[i]
                inner = runs_to_html(block_runs(li))
                kids = ""
                if li.get("has_children"):
                    try:
                        kids = talk_body_html(nt, nt.children(li["id"]), depth + 1)
                    except ClientFailure as e:
                        warn(f"회의록 하위 항목 조회 실패 — 건너뜁니다: {e}")
                if inner or kids:
                    lis.append(f"<li>{inner}{kids}</li>")
                i += 1
            if lis:
                parts.append(f"<{tag}>{''.join(lis)}</{tag}>")
            continue

        if t in TALK_HEADING_TAG:
            h = runs_to_html(block_runs(b))
            if h:
                parts.append(f"<{TALK_HEADING_TAG[t]}>{h}</{TALK_HEADING_TAG[t]}>")

        elif t == "paragraph":
            h = runs_to_html(block_runs(b))
            if h:
                parts.append(f"<p>{h}</p>")

        elif t == "divider":
            parts.append("<hr>")

        elif t == "table":
            parts.append(talk_table_html(nt, b))

        elif t == "callout":
            h = runs_to_html(block_runs(b))
            kids = ""
            if b.get("has_children"):
                try:
                    kids = talk_body_html(nt, nt.children(b["id"]), depth + 1)
                except ClientFailure as e:
                    warn(f"회의록 콜아웃 조회 실패 — 건너뜁니다: {e}")
            if h or kids:
                parts.append(f'<div class="cl">{f"<p>{h}</p>" if h else ""}{kids}</div>')

        # 그 밖(image·embed·child_database 등)은 조용히 건너뛴다
        i += 1

    return "".join(p for p in parts if p)


def fetch_talk_body(nt: Notion, page_id: str, title: str) -> str:
    try:
        return talk_body_html(nt, nt.children(page_id))
    except ClientFailure as e:
        warn(f"회의록 본문 조회 실패 — 본문 없이 내보냅니다({title[:24]}): {e}")
        return ""


# ── 노션 소통 DB: 읽기 (보류만 제외) ─────────────────────────────────────

def read_talks(nt: Notion, client_page_id: str) -> list[dict]:
    """클라이언트 릴레이션으로 거르고 「보류」만 뺀다.
    화면에 무엇이 나갈지는 이 함수 하나가 정한다."""
    try:
        res = nt.post(f"/databases/{TALKS_DB_ID}/query", {
            "page_size": TALKS_OUTPUT_MAX,
            "filter": {"and": [
                {"property": "클라이언트", "relation": {"contains": client_page_id}},
                # 상태가 비어 있어도 내보낸다. 빼는 것은 「보류」뿐이다.
                {"or": [
                    {"property": "상태", "select": {"does_not_equal": TALK_STATUS_HIDDEN}},
                    {"property": "상태", "select": {"is_empty": True}},
                ]},
            ]},
            "sorts": [{"property": "일자", "direction": "descending"}],
        })
    except ClientFailure as e:
        warn(f"소통 DB 조회 실패 — talks=[]: {e}")
        return []

    out = []
    for pg in res.get("results", []):
        pr = pg.get("properties", {})
        channel = p_select(pr, "채널") or ""
        summary = p_text(pr, "요약")

        # 미팅·유선은 회의록이 페이지 본문에 있다. 메일은 지금처럼 「요약」이 본문이다.
        body = body_html = None
        if channel in TALK_CHANNELS_WITH_MINUTES:
            body_html = fetch_talk_body(nt, pg["id"], p_text(pr, "제목")) or None
        else:
            body = nn(summary)

        out.append({
            "date": (p_date(pr, "일자").get("start") or "")[:10],
            "channel": channel,
            "title": p_text(pr, "제목"),
            # 목록 한 줄은 채널과 무관하게 「요약」을 쓴다
            "preview": nn(summary),
            "body": body,
            "body_html": body_html,
            "direction": p_select(pr, "방향"),
        })
    return out


def build_talks(nt: Notion, client: dict, company_name: str,
                skip_imap: bool, dry_run: bool, known_names: set[str]) -> list[dict]:
    if skip_imap:
        log("  메일 수집 건너뜀 (--skip-imap)")
    else:
        mails = fetch_mails(company_name, known_names)
        if mails and dry_run:
            # dry-run 은 아무것도 바꾸지 않는다. 파일도, 노션도.
            log(f"  (dry-run) 노션 쓰기 건너뜀 — 대상 {len(mails)}건")
        elif mails:
            sync_mails_to_notion(nt, client["page_id"], mails)
    # IMAP 이 실패해도 읽기는 그대로 진행한다.
    return read_talks(nt, client["page_id"])


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

    # 줄바꿈을 원본 그대로 둔다. read_text(newline=...) 은 3.13+ 이라 open 으로 연다.
    with src.open(encoding="utf-8", newline="") as f:
        raw = f.read()
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

def build_one(nt: Notion, client: dict, include_expired: bool, dry_run: bool,
              skip_imap: bool, known_names: set[str]) -> dict:
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

    talks = build_talks(nt, client, name, skip_imap, dry_run, known_names)
    log(f"  소통 내역 {len(talks)}건 (보류 제외)")

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
            # 좌측 「자료」 그룹 링크. 가이드북은 클라이언트 공통이라 상수다.
            # 공개되는 index.html 이 아니라 암호화되는 payload 에 넣는다.
            "drive_url": client.get("drive_url"),
            "bizplan_url": client.get("bizplan_url"),
            "guidebook_url": GUIDEBOOK_URL,
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


def build(only: str | None, include_expired: bool, dry_run: bool,
          skip_imap: bool) -> int:
    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not token:
        log("NOTION_TOKEN 이 없습니다. .env 를 확인하세요 (.env.example 참고).")
        return 2

    nt = Notion(token)
    clients, known_names = fetch_clients(nt, only)
    if only and not clients:
        log(f"슬러그 {only!r} 에 해당하는 클라이언트를 찾지 못했습니다.")
        return 2
    log(f"빌드 대상 {len(clients)}건: {', '.join(c['slug'] for c in clients)}")

    failed, plaintext = [], []
    for c in clients:
        try:
            res = build_one(nt, c, include_expired, dry_run, skip_imap, known_names)
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
    ap.add_argument("--dry-run", action="store_true",
                    help="아무것도 바꾸지 않는다 — 파일도, 노션도 쓰지 않는다")
    ap.add_argument("--no-include-expired", action="store_true",
                    help="마감이 지난 추천 사업·일정을 제외한다")
    ap.add_argument("--skip-imap", action="store_true",
                    help="메일 수집을 건너뛰고 노션 소통 DB 만 읽는다")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    include_expired = INCLUDE_EXPIRED and not args.no_include_expired
    return build(args.client, include_expired, args.dry_run, args.skip_imap)


if __name__ == "__main__":
    sys.exit(main())
