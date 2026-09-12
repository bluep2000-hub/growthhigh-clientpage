#!/usr/bin/env python3
"""로컬 처리 장부를 PM이 읽을 수 있는 오프라인 현황 화면으로 만든다."""

from __future__ import annotations

import argparse
import html
import io
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from recording_jobs import RecordingJobError, RecordingJobStore


SCHEDULE = "매일 오전 9시 · 오후 1시 · 오후 6시"
SCHEDULE_HOURS = (9, 13, 18)
STALE_GRACE = timedelta(minutes=90)


def default_status_path(store: RecordingJobStore | None = None) -> Path:
    override = os.environ.get("RECORDING_STATUS_PAGE", "").strip()
    if override:
        return Path(override)
    store = store or RecordingJobStore()
    return store.path.parent / "status.html"


def status_kind(job: dict) -> str:
    state = str(job.get("state") or "")
    error = str(job.get("last_error_code") or "")
    if state == "complete":
        return "complete"
    if state == "needs_review" and error == "WAITING_PUBLIC_APPROVAL":
        return "approval"
    if state in {"needs_review", "failed"}:
        return "attention"
    return "working"


def status_label(job: dict) -> str:
    return {
        "attention": "확인 필요",
        "approval": "승인 대기",
        "working": "처리 중",
        "complete": "완료",
    }[status_kind(job)]


def stage_detail(job: dict) -> str:
    kind = status_kind(job)
    if kind == "attention":
        return str(job.get("last_error_detail") or "자동 처리 중 멈췄습니다.")
    if kind == "approval":
        return "Notion 초안을 검토한 뒤 ‘고객 공개’를 체크해 주세요."
    if kind == "complete":
        return "고객 화면 반영까지 완료되었습니다."
    return {
        "received": "새 녹음을 확인했습니다.",
        "transcribing": "녹음을 받아쓰고 있습니다.",
        "transcribed": "전사를 마치고 회의록 생성을 기다립니다.",
        "summarizing": "회의록 초안을 만들고 있습니다.",
        "notion_writing": "Notion 비공개 초안을 등록하고 있습니다.",
        "building": "고객 화면 반영을 요청하고 있습니다.",
    }.get(str(job.get("state") or ""), "자동 처리 중입니다.")


def safe_notion_url(value: object) -> str | None:
    raw = str(value or "").strip()
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme != "https":
        return None
    if parsed.hostname not in {"notion.so", "www.notion.so", "app.notion.com"}:
        return None
    return raw


def local_time(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "시간 미상"
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone().strftime(
            "%m월 %d일 %H:%M"
        )
    except ValueError:
        return raw


def next_stale_at(rendered_at: datetime) -> datetime:
    """현재 갱신 다음 예약 시각에 유예 시간을 더한 경고 시각을 반환한다."""
    rendered_at = rendered_at.astimezone()
    candidates = [
        rendered_at.replace(hour=hour, minute=0, second=0, microsecond=0)
        for hour in SCHEDULE_HOURS
    ]
    next_run = next((candidate for candidate in candidates if candidate > rendered_at), None)
    if next_run is None:
        next_run = (rendered_at + timedelta(days=1)).replace(
            hour=SCHEDULE_HOURS[0], minute=0, second=0, microsecond=0
        )
    return next_run + STALE_GRACE


def render_job(job: dict) -> str:
    kind = status_kind(job)
    name = html.escape(str(job.get("source_name") or "이름 없는 녹음"))
    company = html.escape(str(job.get("company_name") or "고객사 미상"))
    occurred = html.escape(str(job.get("occurred_at") or "일자 미상"))
    channel = html.escape(str(job.get("channel") or "통화"))
    detail = html.escape(stage_detail(job))
    updated = html.escape(local_time(job.get("updated_at")))
    notion_url = safe_notion_url(job.get("notion_url"))
    notion = (
        f'<a class="notion" href="{html.escape(notion_url, quote=True)}" '
        'target="_blank" rel="noopener">Notion 초안 열기</a>'
        if notion_url and kind == "approval" else ""
    )
    recovery = (
        '<p class="recovery">Codex에 “자동화 확인 필요”라고 요청해 주세요.</p>'
        if kind == "attention" else ""
    )
    return f"""<article class="job job-{kind}">
      <div class="state"><span class="dot" aria-hidden="true"></span>{status_label(job)}</div>
      <div class="job-main"><h3>{name}</h3>
        <p class="meta">{company}<i>·</i>{occurred}<i>·</i>{channel}</p>
        <p class="detail">{detail}</p>{recovery}{notion}</div>
      <time>{updated}</time>
    </article>"""


def render_page(jobs: list[dict], *, rendered_at: datetime | None = None) -> str:
    rendered_at = (rendered_at or datetime.now().astimezone()).astimezone()
    stale_after = html.escape(next_stale_at(rendered_at).isoformat(), quote=True)
    ordered = sorted(
        jobs,
        key=lambda job: str(job.get("updated_at") or ""),
        reverse=True,
    )
    ordered.sort(
        key=lambda job: {
            "attention": 0,
            "approval": 1,
            "working": 2,
            "complete": 3,
        }[status_kind(job)]
    )
    counts = {key: 0 for key in ("attention", "approval", "working", "complete")}
    for job in ordered:
        counts[status_kind(job)] += 1
    rows = "".join(render_job(job) for job in ordered)
    if not rows:
        rows = """<div class="empty"><strong>아직 처리 내역이 없습니다.</strong>
          <p>고객사 접수 폴더에 녹음을 올리면 다음 자동 확인 뒤 여기에 표시됩니다.</p></div>"""
    checked = rendered_at.strftime("%Y년 %m월 %d일 %H:%M")
    attention = counts["attention"]
    summary = (
        f'<strong class="summary-alert">확인이 필요한 항목이 {attention}건 있습니다.</strong>'
        if attention else '<strong>현재 멈춘 작업이 없습니다.</strong>'
    )
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>자동화 현황 · GROWTH'HIGH</title>
<style>
:root{{--bg:#f7f7f8;--panel:#fff;--line:#e3e5ea;--line2:#c9cdd5;--tx:#16181d;
  --tx2:#4a4f5a;--tx3:#666d79;--accent:#3d4ba8;--accent-bg:#e9ebf6;
  --ok:#1f7a52;--ok-bg:#e6f4ec;--warn:#8f5f0d;--warn-bg:#fdf3e0;
  --no:#a34b45;--no-bg:#fbeae8;--sans:'Pretendard',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}}
*{{box-sizing:border-box}}
html{{background:var(--bg);color:var(--tx);font-family:var(--sans);font-size:14px}}
body{{margin:0;min-height:100vh}}
button,a{{font:inherit}}
a{{color:inherit}}
:focus-visible{{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}}
::selection{{background:var(--accent-bg);color:var(--tx)}}
.wrap{{width:min(1040px,calc(100% - 40px));margin:0 auto;padding:42px 0 72px}}
.top{{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:52px}}
.brand{{font-size:12px;font-weight:800;letter-spacing:.12em}}
.local{{font-size:12px;color:var(--tx3)}}
.lead{{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:end;
  padding-bottom:24px;border-bottom:1px solid var(--line2)}}
h1{{font-size:clamp(30px,4vw,46px);line-height:1.1;letter-spacing:-.035em;margin:0 0 12px}}
.lead p{{margin:0;color:var(--tx2);max-width:62ch;line-height:1.7}}
.lead p,.foot{{overflow-wrap:anywhere}}
.refresh{{border:1px solid var(--line2);background:var(--panel);color:var(--tx2);border-radius:7px;
  padding:8px 12px;cursor:pointer}}
.refresh:hover{{background:var(--accent-bg);color:var(--accent);border-color:var(--accent)}}
.strip{{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap;padding:18px 0 14px}}
.strip span{{color:var(--tx2);font-size:12.5px}}
.strip b{{color:var(--tx);font-variant-numeric:tabular-nums}}
.strip .attention b{{color:var(--no)}}
.strip .approval b{{color:var(--warn)}}
.strip .complete b{{color:var(--ok)}}
.overview{{display:flex;justify-content:space-between;gap:16px;align-items:baseline;
  padding:14px 0 28px;color:var(--tx2)}}
.overview strong{{color:var(--ok);font-size:13px}}
.overview .summary-alert{{color:var(--no)}}
.overview small{{font-size:11.5px;color:var(--tx3);font-variant-numeric:tabular-nums}}
.stale{{display:flex;justify-content:space-between;gap:10px 18px;align-items:baseline;
  margin:0 0 20px;padding:12px 14px;border:1px solid var(--no);border-radius:8px;
  background:var(--no-bg);color:var(--no);font-size:12px;line-height:1.5}}
.stale strong{{font-size:12.5px}}[hidden]{{display:none!important}}
.ledger{{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}}
.ledger-head{{display:flex;align-items:baseline;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line)}}
.ledger-head h2{{font-size:14px;margin:0}}
.ledger-head span{{font-size:11.5px;color:var(--tx3);font-variant-numeric:tabular-nums}}
.job{{min-width:0;display:grid;grid-template-columns:98px minmax(0,1fr) 112px;gap:18px;padding:17px 18px;
  align-items:start;border-bottom:1px solid var(--line)}}
.job:last-child{{border-bottom:0}}
.job-main{{min-width:0}}
.state{{display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;white-space:nowrap}}
.dot{{width:7px;height:7px;border-radius:50%;background:var(--accent)}}
.job-attention .state{{color:var(--no)}}.job-attention .dot{{background:var(--no)}}
.job-approval .state{{color:var(--warn)}}.job-approval .dot{{background:var(--warn)}}
.job-complete .state{{color:var(--ok)}}.job-complete .dot{{background:var(--ok)}}
.job h3{{font-size:13.5px;line-height:1.45;margin:0 0 4px;overflow-wrap:anywhere}}
.meta{{display:flex;gap:7px;flex-wrap:wrap;margin:0;color:var(--tx3);font-size:11.5px}}
.meta i{{font-style:normal;color:var(--line2)}}
.detail{{margin:8px 0 0;color:var(--tx2);font-size:12.5px;line-height:1.55}}
.recovery{{margin:3px 0 0;color:var(--no);font-size:11.5px}}
.notion{{display:inline-block;margin-top:9px;color:var(--accent);font-size:12px;font-weight:700;
  text-decoration:underline;text-underline-offset:3px}}
.job time{{text-align:right;color:var(--tx3);font-size:11px;font-variant-numeric:tabular-nums}}
.empty{{padding:46px 20px;text-align:center}}
.empty strong{{font-size:14px}}.empty p{{margin:7px 0 0;color:var(--tx3);font-size:12.5px}}
.foot{{margin-top:18px;color:var(--tx3);font-size:11.5px;line-height:1.7}}
@media(max-width:680px){{
  html,body{{width:100%;max-width:100%;overflow-x:hidden}}
  .wrap{{width:auto;max-width:none;margin:0 12px;padding:24px 0 52px}}.top{{margin-bottom:36px}}
  .lead,.strip,.overview,.ledger,.foot{{min-width:0;max-width:100%}}
  .local{{display:none}}.lead{{grid-template-columns:1fr;align-items:start}}.refresh{{justify-self:start}}
  .overview{{align-items:flex-start;flex-direction:column;gap:5px}}
  .stale{{align-items:flex-start;flex-direction:column;gap:3px}}
  .job{{grid-template-columns:1fr;gap:8px;padding:15px}}.job time{{text-align:left}}
  .ledger-head{{padding:13px 15px}}
}}
@media(prefers-color-scheme:dark){{
  :root{{--bg:#1a1a1e;--panel:#212127;--line:rgba(255,255,255,.07);
    --line2:rgba(255,255,255,.13);--tx:#e4e4e8;--tx2:#b7b7c0;--tx3:#9a9aa6;
    --accent:#aeb8ff;--accent-bg:rgba(94,106,210,.18);--ok:#70c79a;--ok-bg:rgba(76,175,125,.14);
    --warn:#e2b860;--warn-bg:rgba(217,164,65,.14);--no:#df8a84;--no-bg:rgba(192,100,95,.14)}}
}}
</style>
</head>
<body>
<!--
THESIS: PM이 터미널 대신 한 장의 처리 장부에서 멈춘 녹음을 먼저 발견한다.
OWN-WORLD: 기존 GrowthHigh의 중성 바탕, 얇은 경계, 보라 포인트와 상태색을 잇는다.
STORY: 마지막 자동 확인 확인 → 주의 항목 파악 → 승인 대기 초안을 Notion에서 검토한다.
FIRST VIEWPORT: 큰 현황 제목, 세 번의 실행 시각, 상태 문장과 우선순위 장부가 한 화면에 온다.
FORM: local-extension-direct — 기존 운영 화면의 코드 주도 확장으로 concept seed는 적용하지 않는다. 장식 카드나 개발 로그를 노출하지 않는다.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->
<main class="wrap">
  <header class="top"><div class="brand">GROWTH'HIGH</div><div class="local">이 PC에만 저장되는 담당자 화면</div></header>
  <section class="lead"><div><h1>자동화 현황</h1>
    <p>PM이 접수한 통화녹음의 전사, 회의록, 승인과 고객 화면 반영 상태입니다.<br>{SCHEDULE}에 자동으로 확인합니다.</p></div>
    <button class="refresh" type="button" onclick="location.reload()">화면 새로고침</button></section>
  <div class="strip" aria-label="상태별 건수">
    <span class="counts-label" id="counts-label" hidden>마지막 저장 기준</span>
    <span class="attention">확인 필요 <b>{counts['attention']}</b></span>
    <span class="approval">승인 대기 <b>{counts['approval']}</b></span>
    <span>처리 중 <b>{counts['working']}</b></span>
    <span class="complete">완료 <b>{counts['complete']}</b></span>
  </div>
  <div class="overview"><span id="health-summary">{summary}</span><small>마지막 자동 확인 {checked}</small></div>
  <aside class="stale" id="stale-warning" data-stale-after="{stale_after}" hidden>
    <strong>마지막 자동 확인이 예정 시각보다 늦었습니다.</strong>
    <span>Codex에 “자동화 확인 필요”라고 요청해 주세요.</span>
  </aside>
  <section class="ledger"><header class="ledger-head"><h2>처리 내역</h2><span>{len(ordered)}건</span></header>{rows}</section>
  <p class="foot">이 화면은 자동화가 실행될 때 갱신됩니다. 음성·전사·회의록 본문은 이 파일에 저장하지 않습니다.</p>
</main>
<script>
(function(){{
  const warning=document.getElementById('stale-warning');
  const healthSummary=document.getElementById('health-summary');
  const countsLabel=document.getElementById('counts-label');
  const staleAt=Date.parse(warning.dataset.staleAfter);
  if(Number.isFinite(staleAt)&&Date.now()>=staleAt){{
    warning.hidden=false;
    healthSummary.innerHTML='<strong class="summary-alert">현재 처리 상태를 확인할 수 없습니다.</strong>';
    countsLabel.hidden=false;
  }}
  setTimeout(function(){{location.reload()}},60000);
}})();
</script>
</body>
</html>"""


def write_page(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temp.write_text(contents, encoding="utf-8")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="로컬 녹음 자동화 현황 화면 생성")
    parser.add_argument("--dry-run", action="store_true",
                        help="출력 위치만 확인하고 파일은 바꾸지 않는다")
    parser.add_argument("--limit", metavar="개수", type=int, default=None,
                        help="상위 파이프라인과 같은 명령 모양을 유지한다")
    args = parser.parse_args()
    try:
        store = RecordingJobStore()
        jobs = store.all()
        output = default_status_path(store)
    except RecordingJobError as exc:
        print(f"처리 장부 확인 필요: {exc}")
        return 1
    print(f"로컬 처리 현황 {len(jobs)}건 → {output}")
    if args.dry_run:
        print("dry-run 이라 화면 파일은 바꾸지 않는다.")
        return 0
    write_page(output, render_page(jobs))
    print("  → 담당자 현황 화면 갱신")
    return 0


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    raise SystemExit(main())
