#!/usr/bin/env python3
"""신규 고객 한 곳의 Notion 뼈대 → 메일 → 비공개 빌드를 단계별로 진행한다."""

import argparse
import contextlib
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import build_client as b
from client_mapping import register_client
from transcribe_drive import TALKS_DIR, inbox_path


def material_for(name, company):
    return (name == f"{company} 사전진단리포트" or
            bool(re.fullmatch(rf"\d{{4}}-\d{{2}}-\d{{2}} {re.escape(company)} - .+", name)))


def heading(text):
    return {"object": "block", "type": "heading_2", "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": text}}]}}


def timetable_blocks():
    columns = ["분야", "목적", "시작월", "종료월", "실행 항목", "표시색"]
    return [heading("컨설팅 타임테이블"), {"object": "block", "type": "table", "table": {
        "table_width": len(columns), "has_column_header": True,
        "children": [{"object": "block", "type": "table_row", "table_row": {
            "cells": [[{"type": "text", "text": {"content": value}}] for value in columns]}}]}}]


def page_state(nt, company, slug):
    companies = nt.query_all(b.COMPANY_DB_ID, {"filter": {
        "property": "기업명", "title": {"equals": company}}})
    if len(companies) != 1:
        raise ValueError(f"기업 DB에서 정확히 일치하는 행이 {len(companies)}건입니다")
    company_page = companies[0]
    rows = nt.query_all(b.SHARE_DB_ID)
    pages = [row for row in rows if b.CLIENT_PAGE_TYPE in
             b.p_multi(row.get("properties", {}), "페이지 유형") and
             (company_page["id"] in b.p_relation(row.get("properties", {}), "기업 DB") or
              b.p_text(row.get("properties", {}), "페이지명") == f"{company} 클라이언트페이지")]
    if len(pages) > 1:
        raise ValueError("이 기업의 클라이언트페이지가 중복 등록돼 있습니다")
    if any(b.p_text(row.get("properties", {}), "슬러그") == slug and
           (not pages or row["id"] != pages[0]["id"]) for row in rows):
        raise ValueError("영문 주소가 이미 다른 공유페이지에 쓰이고 있습니다")
    if pages and b.p_text(pages[0]["properties"], "슬러그") not in ("", slug):
        raise ValueError("기존 클라이언트페이지의 영문 주소가 다릅니다")
    materials = [row for row in rows if material_for(
        b.p_text(row.get("properties", {}), "페이지명"), company)]
    known = set().union(*(b.client_name_tokens(b.p_text(
        row.get("properties", {}), "페이지명")) for row in rows))
    return company_page, pages[0] if pages else None, materials, known


def initial_blocks(company_id, materials):
    blocks = [heading("기업 정보"), {"object": "block", "type": "link_to_page",
                                     "link_to_page": {"type": "page_id", "page_id": company_id}},
              heading("📁 데이터룸 · 주요 자료")]
    for row in materials:
        if not row.get("public_url"):
            continue
        name = b.p_text(row["properties"], "페이지명")
        url = f"https://app.notion.com/p/{row['id'].replace('-', '')}"
        blocks.append({"object": "block", "type": "bulleted_list_item",
                       "bulleted_list_item": {"rich_text": [{"type": "text", "text": {
                           "content": name, "link": {"url": url}}}]}})
    blocks.append({"object": "block", "type": "divider", "divider": {}})
    blocks.extend(timetable_blocks())
    return blocks


def ensure_page(nt, company, slug, company_page, page, materials):
    if page:
        patch = {}
        if not b.p_text(page["properties"], "슬러그"):
            patch["슬러그"] = {"rich_text": [{"text": {"content": slug}}]}
        if not b.p_relation(page["properties"], "기업 DB"):
            patch["기업 DB"] = {"relation": [{"id": company_page["id"]}]}
        if patch:
            nt.patch(f"/pages/{page['id']}", {"properties": patch})
        print("1/3 Notion 페이지: 기존 페이지 재사용")
        return page["id"]
    props = company_page.get("properties", {})
    managers = [{"id": p["id"]} for p in props.get("담당자", {}).get("people", [])]
    page_props = {
        "페이지명": {"title": [{"text": {"content": f"{company} 클라이언트페이지"}}]},
        "페이지 유형": {"multi_select": [{"name": b.CLIENT_PAGE_TYPE}]},
        "기업 DB": {"relation": [{"id": company_page["id"]}]},
        "슬러그": {"rich_text": [{"text": {"content": slug}}]},
    }
    if managers:
        page_props["담당자"] = {"people": managers}
    created = nt.post("/pages", {"parent": {"database_id": b.SHARE_DB_ID},
                                 "properties": page_props,
                                 "children": initial_blocks(company_page["id"], materials)})
    print("1/3 Notion 페이지: 생성 및 기업·게시 자료 연결")
    return created["id"]


def ensure_view(nt, page_id, label, db_id, condition):
    children = nt.children(page_id)
    for i, block in enumerate(children):
        if block["type"] != "heading_2":
            continue
        title = "".join(r.get("plain_text", "") for r in block["heading_2"]["rich_text"])
        if title != label:
            continue
        following = children[i + 1:]
        if following and following[0]["type"] == "child_database":
            print(f"    {label}: 기존 연결 보기 재사용")
            return
        break
    else:
        nt.patch(f"/blocks/{page_id}/children", {"children": [heading(label)]})
    meta = nt._request("GET", f"/databases/{db_id}",
                       headers={"Notion-Version": "2026-03-11"})
    sources = meta.get("data_sources") or []
    if len(sources) != 1:
        raise ValueError(f"{label} 원본 데이터 소스를 하나로 정할 수 없습니다")
    nt._request("POST", "/views", json={
        "create_database": {"parent": {"type": "page_id", "page_id": page_id}},
        "data_source_id": sources[0]["id"], "name": label, "type": "table",
        "filter": condition,
    }, headers={"Notion-Version": "2026-03-11"})
    print(f"    {label}: 고객사 필터 연결")


def option_exists(nt, company):
    db = nt.get(f"/databases/{b.TALKS_DB_ID}")
    options = db["properties"]["기업명"]["multi_select"]["options"]
    return any(option["name"] == company for option in options)


def ensure_timetable(nt, page_id):
    children = nt.children(page_id)
    for i, block in enumerate(children):
        if block["type"] != "heading_2":
            continue
        title = "".join(r.get("plain_text", "") for r in block["heading_2"]["rich_text"])
        if title == "컨설팅 타임테이블":
            if i + 1 < len(children) and children[i + 1]["type"] == "table":
                print("    컨설팅 타임테이블: 기존 빈칸 재사용")
                return
            raise ValueError("컨설팅 타임테이블 제목 아래 표가 없습니다")
    nt.patch(f"/blocks/{page_id}/children", {"children": timetable_blocks()})
    print("    컨설팅 타임테이블: 빈칸 생성")


def ensure_room(nt, page_id):
    headings = ["".join(r.get("plain_text", "") for r in block["heading_2"]["rich_text"])
                for block in nt.children(page_id) if block["type"] == "heading_2"]
    if not any("주요 자료" in title for title in headings):
        nt.patch(f"/blocks/{page_id}/children", {"children": [heading("📁 데이터룸 · 주요 자료")]})
        print("    데이터룸: 빈칸 생성")
    else:
        print("    데이터룸: 기존 자료칸 재사용")


def ensure_recording_folder(company, slug):
    if company in (".", "..") or any(char in company for char in '\\/:*?"<>|'):
        raise ValueError("고객사 이름을 안전한 녹음 폴더명으로 쓸 수 없습니다")
    root = Path(os.environ.get("TALKS_DIR") or TALKS_DIR)
    try:
        inbox = inbox_path(root)
        folder = inbox / company
        folder.mkdir(exist_ok=True)
        if not folder.is_dir():
            raise ValueError("고객사 녹음 접수 폴더가 아닙니다")
        register_client(company, slug)
    except OSError as error:
        raise ValueError("녹음 접수 폴더를 만들거나 연결하지 못했습니다") from error
    print(f"    녹음 접수함: {folder}")


def inspect_scaffold(nt, page_id, company):
    children = nt.children(page_id)
    headings = [(i, "".join(r.get("plain_text", "") for r in block["heading_2"]["rich_text"]))
                for i, block in enumerate(children) if block["type"] == "heading_2"]
    timetable = any(title == "컨설팅 타임테이블" and i + 1 < len(children)
                    and children[i + 1]["type"] == "table" for i, title in headings)
    room = any("주요 자료" in title for _, title in headings)
    try:
        root = Path(os.environ.get("TALKS_DIR") or TALKS_DIR)
        folder = inbox_path(root) / company
        recording = "있음" if folder.is_dir() else "미생성"
    except (ValueError, OSError):
        recording = "접수함 위치 확인 필요"
    print(f"제작 뼈대: 타임테이블 {'있음' if timetable else '미생성'} / "
          f"데이터룸 {'있음' if room else '미생성'} / 녹음 폴더 {recording}")


def prepare(nt, company, slug, company_page, page, materials):
    page_id = ensure_page(nt, company, slug, company_page, page, materials)
    ensure_room(nt, page_id)
    ensure_timetable(nt, page_id)
    ensure_view(nt, page_id, "고객사 프로젝트", b.PROJECT_DB_ID, {
        "property": "고객사 정보", "relation": {"contains": company_page["id"]}})
    if option_exists(nt, company):
        ensure_view(nt, page_id, "고객 공개 소통", b.TALKS_DB_ID, {"and": [
            {"property": "기업명", "multi_select": {"contains": company}},
            {"property": "고객 공개", "checkbox": {"equals": True}}]})
    else:
        print("    고객 공개 소통: 분류 미등록, 메일 단계 뒤 연결")
    ensure_recording_folder(company, slug)
    return page_id


def mail(nt, company, known, page_id):
    b.WARNINGS.clear()
    # ponytail: 최초 이력은 폴더당 5천 통까지만 훑는다. 넘으면 IMAP 구간 조회로 바꾼다.
    b.TALKS_SCAN_MAX = 5000
    with contextlib.redirect_stdout(io.StringIO()):
        mails = b.fetch_mails(company, known, 0)
    print(f"2/3 메일: 일치 {len(mails)}건")
    if b.WARNINGS:
        print("    수집 범위 경고:", " / ".join(b.WARNINGS))
        raise ValueError("메일 수집이 일부만 끝났습니다")
    if not all(os.environ.get(k) for k in ("IMAP_HOST", "IMAP_USER", "IMAP_PASS")):
        raise ValueError("IMAP 설정이 없어 메일 단계를 완료할 수 없습니다")
    b.sync_mails_to_notion(nt, page_id, mails)
    b.sync_mails_to_board(nt, company, mails)
    if b.WARNINGS:
        raise ValueError("메일 동기화에 누락된 항목이 있습니다")
    old_rows = nt.query_all(b.MAIL_TALKS_DB_ID, {"filter": {
        "property": "클라이언트", "relation": {"contains": page_id}}})
    old_ids = {b.p_text(row.get("properties", {}), "Message-ID") for row in old_rows}
    board_rows = nt.query_all(b.TALKS_DB_ID, {"filter": {"and": [
        {"property": "기업명", "multi_select": {"contains": company}},
        {"property": "소통형태", "multi_select": {"contains": "메일"}}]}})
    board_keys = {((b.p_date(row.get("properties", {}), "일자").get("start") or "")[:10],
                   b.p_text(row.get("properties", {}), "상세내용")) for row in board_rows}
    if any(m.get("message_id") not in old_ids or
           ((m.get("date") or "")[:10], m.get("title") or "") not in board_keys
           for m in mails):
        raise ValueError("메일 원본 DB 또는 커뮤니케이션보드에서 동기화 결과가 누락됐습니다")
    if option_exists(nt, company):
        ensure_view(nt, page_id, "고객 공개 소통", b.TALKS_DB_ID, {"and": [
            {"property": "기업명", "multi_select": {"contains": company}},
            {"property": "고객 공개", "checkbox": {"equals": True}}]})
    print("    원본 메일 DB와 커뮤니케이션보드 반영 확인 완료")


def build(slug):
    run = subprocess.run(["node", str(b.ROOT / "worker/scripts/build-private.mjs"),
                          f"--client={slug}"], cwd=b.ROOT / "worker",
                         env={**os.environ, "PRIVATE_BUILD_PYTHON": sys.executable},
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        result = json.loads(run.stdout)["clients"][0]
    except (ValueError, KeyError, IndexError):
        raise ValueError("비공개 빌드 결과를 확인하지 못했습니다") from None
    if run.returncode or not result.get("saved"):
        raise ValueError(f"비공개 빌드 실패: {result.get('stage')} / {result.get('reason')}")
    print("3/3 비공개 빌드: 저장 및 검증 완료")


def main():
    ap = argparse.ArgumentParser(description="고객사별 최초 제작 단계")
    ap.add_argument("--company", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--step", choices=("inspect", "prepare", "mail", "build"), default="inspect")
    args = ap.parse_args()
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.slug):
        ap.error("영문 주소는 소문자·숫자·하이픈만 쓸 수 있습니다")
    b.load_dotenv(b.ROOT / ".env")
    if not os.environ.get("NOTION_TOKEN"):
        ap.error("NOTION_TOKEN이 없습니다")
    nt = b.Notion(os.environ["NOTION_TOKEN"])
    try:
        company_page, page, materials, known = page_state(nt, args.company, args.slug)
        print(f"기업 원본: 확인 / 클라이언트페이지: {'기존' if page else '미생성'}")
        print(f"자료 후보: 게시 {sum(bool(x.get('public_url')) for x in materials)}건 / 비공개 {sum(not x.get('public_url') for x in materials)}건")
        has_option = option_exists(nt, args.company)
        print(f"소통 분류: {'있음' if has_option else '없음'}")
        if args.step == "inspect":
            if page:
                projects = nt.query_all(b.PROJECT_DB_ID, {"filter": {
                    "property": "고객사 정보", "relation": {"contains": company_page["id"]}}})
                talks = nt.query_all(b.TALKS_DB_ID, {"filter": {"and": [
                    {"property": "기업명", "multi_select": {"contains": args.company}},
                    {"property": "고객 공개", "checkbox": {"equals": True}}]}}) if has_option else []
                links = b.fetch_material_links(nt, page["id"])
                print(f"연결 결과: 프로젝트 {len(projects)}건 / 고객 공개 소통 {len(talks)}건 / 자료 {sum(len(x['items']) for x in links)}건")
                inspect_scaffold(nt, page["id"], args.company)
            return 0
        if args.step == "prepare":
            prepare(nt, args.company, args.slug, company_page, page, materials)
            return 0
        if not page:
            raise ValueError("Notion 페이지부터 생성하세요: --step prepare")
        if args.step == "mail":
            mail(nt, args.company, known, page["id"])
        elif args.step == "build":
            build(args.slug)
        return 0
    except (ValueError, b.ClientFailure) as exc:
        print(f"중단: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
