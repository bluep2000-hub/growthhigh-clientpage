#!/usr/bin/env python3
"""제작부터 배포까지 한 명령으로 묶는다.

    python src/publish.py --client whiffkorea

지금까지는 담당자가 네 단계를 손으로 밟았고, 하나만 빠뜨려도 조용히 잘못된
것이 나갔다. `git pull` 을 빼면 두 PC 가 충돌하고, 재빌드를 빼면 클라이언트는
옛 화면을 보고, 평문 경고를 못 보면 비밀번호 없는 데이터가 그대로 배포됐다.

이 명령은 순서대로 하고, 어디서든 걸리면 **배포까지 가지 않고 멈춘다.**

    1. git pull --rebase      충돌하면 멈춘다. 혼자 풀지 않는다
    2. 사본 검사              check_copies.py — 원본과 갈라졌으면 멈춘다
    3. 빌드                   build_client.py
    4. 평문 검사              「배포하지 마세요」면 멈춘다
    5. 내용 비교              바뀐 게 없으면 커밋하지 않는다
    6. commit → pull → push

5번이 있는 이유는 봉투의 salt·iv 가 매번 무작위라 **내용이 같아도 파일
바이트가 달라지기** 때문이다. 하루 세 번 도는데 그대로 커밋하면 한 달에
90개의 의미 없는 커밋이 쌓이고, 그중 진짜 변경이 어느 것인지 알 수 없게 된다.
그래서 배포된 봉투를 풀어 payload 를 견주고, 같으면 파일을 되돌린다.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

import build_client as bc                                          # noqa: E402
import check_copies                                                # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM     # noqa: E402
from cryptography.hazmat.primitives.hashes import SHA256           # noqa: E402
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC   # noqa: E402

# 빌드할 때마다 달라지는 값. 내용이 바뀌었는지 볼 때는 빼고 견준다.
VOLATILE = ("generated_at",)


def say(msg: str = "") -> None:
    print(msg, flush=True)


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        say(f"\n■ git {' '.join(args)} 실패")
        for line in (r.stderr or r.stdout).strip().splitlines()[:12]:
            say(f"    {line}")
        raise SystemExit(1)
    return r


def owns(path: str, slug: str) -> bool:
    """이 클라이언트의 빌드 산출물인가.

    자동 배포는 사람이 없는 데서 돈다. `git add -A` 로 작업 트리를 통째로
    쓸어 담으면 담당자가 편집 중이던 파일까지 커밋해 push 한다. 실제로
    한 번 그렇게 나갔다. 여기 해당하는 것만 담는다.
    """
    return (path == f"c/{slug}.enc"
            or path.startswith(f"{slug}/")
            or path.startswith(f"logo/{slug}.")
            or path.startswith(f"assets/notice/{slug}-"))


def changed_paths() -> list[str]:
    """작업 트리에서 바뀐 경로. 이름 바꾸기는 새 이름 쪽을 쓴다."""
    r = git("-c", "core.quotepath=false", "status", "--porcelain")
    out = []
    for line in r.stdout.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:                  # R  old -> new
            path = path.split(" -> ", 1)[1]
        out.append(path)
    return out


def decrypt(env: dict, password: str) -> dict | None:
    """봉투를 푼다. 비밀번호가 틀리거나 형식이 다르면 None — 「모른다」이다.

    모를 때는 「바뀌었다」로 취급한다. 비교를 못 했다고 배포를 건너뛰면
    진짜 변경이 묻힌다.
    """
    try:
        if not env.get("enc"):
            return env.get("data")
        key = PBKDF2HMAC(algorithm=SHA256(), length=32,
                         salt=base64.b64decode(env["salt"]),
                         iterations=env["iterations"]).derive(password.encode("utf-8"))
        pt = AESGCM(key).decrypt(base64.b64decode(env["iv"]),
                                 base64.b64decode(env["data"]), None)
        return json.loads(pt.decode("utf-8"))
    except Exception:                       # noqa: BLE001 — 못 풀면 「모른다」
        return None


def stable(payload: dict | None) -> dict | None:
    if payload is None:
        return None
    return {k: v for k, v in payload.items() if k not in VOLATILE}


def head_envelope(slug: str) -> dict | None:
    """마지막으로 배포된 봉투. 아직 없으면 None (새 클라이언트다)."""
    r = git("show", f"HEAD:c/{slug}.enc", check=False)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def section_diff(old: dict, new: dict) -> list[str]:
    """무엇이 달라졌는지 사람 말로. 보고 세 줄에 들어간다."""
    names = {"talks": "소통 내역", "progress": "프로젝트", "events": "일정",
             "recommend": "추천 지원사업", "notice": "공지", "perf": "조달현황",
             "meta": "기업 정보", "kpi": "KPI"}
    out = []
    for k in sorted(set(old) | set(new)):
        a, b = old.get(k), new.get(k)
        if a == b:
            continue
        label = names.get(k, k)
        if isinstance(a, list) and isinstance(b, list) and len(a) != len(b):
            out.append(f"{label} {len(a)}→{len(b)}건")
        else:
            out.append(label)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="빌드부터 배포까지 한 번에")
    ap.add_argument("--client", metavar="슬러그", required=True, help="배포할 클라이언트")
    ap.add_argument("--dry-run", action="store_true",
                    help="빌드까지만 하고 커밋·푸시하지 않는다")
    ap.add_argument("--no-pull", action="store_true", help="git pull 을 건너뛴다")
    ap.add_argument("--skip-imap", action="store_true", help="메일 수집을 건너뛴다")
    ap.add_argument("--talks-days", metavar="일수", type=int, default=bc.TALKS_DAYS,
                    help=f"메일 수집 기간 (기본 {bc.TALKS_DAYS}일)")
    args = ap.parse_args()
    slug = args.client

    bc.load_dotenv(ROOT / ".env")

    # ── 1. 최신 상태로 ──────────────────────────────────────────────
    if not args.no_pull:
        say("① git pull --rebase")
        r = git("pull", "--rebase", check=False)
        if r.returncode != 0:
            say("\n■ pull 이 깨끗하게 끝나지 않았습니다. 여기서 멈춥니다.")
            for line in (r.stderr or r.stdout).strip().splitlines()[:12]:
                say(f"    {line}")
            say("\n  충돌을 먼저 정리한 뒤 다시 실행하세요. 자동으로 풀지 않습니다.")
            return 1
        say(f"   {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else '최신'}")

    # ── 1-1. 작업 트리가 깨끗한가 ───────────────────────────────────
    # 자동 배포가 남의 작업물을 커밋하지 않게 한다. 예약 세션은 사람이
    # 안 볼 때 도니까, 편집 중인 파일이 있으면 손대지 말고 멈춰야 한다.
    others = [p for p in changed_paths() if not owns(p, slug)]
    if others and not args.dry_run:
        say(f"\n■ {slug} 산출물이 아닌 파일 {len(others)}개가 바뀌어 있습니다.")
        for p in others[:12]:
            say(f"    {p}")
        if len(others) > 12:
            say(f"    … 외 {len(others) - 12}개")
        say("\n  이것들까지 커밋하게 되므로 멈춥니다.")
        say("  먼저 커밋하거나 되돌린 뒤 다시 실행하세요.")
        return 1

    # ── 2. 사본이 원본과 맞는가 ─────────────────────────────────────
    say(f"\n② 사본 검사 — {slug}")
    rc, rows = check_copies.check(slug)
    if rc == 2:
        return 2
    check_copies.report(rows, quiet=False)
    if rc:
        say("\n■ 사본이 원본 템플릿과 맞지 않습니다. 배포하지 않습니다.")
        return 1

    # ── 3. 빌드 ─────────────────────────────────────────────────────
    say(f"\n③ 빌드")
    rc = bc.build(only=slug, include_expired=False, dry_run=args.dry_run,
                  skip_imap=args.skip_imap, allow_plaintext=False,
                  talks_days=args.talks_days)

    # ── 4. 평문 검사 ────────────────────────────────────────────────
    # build() 는 비밀번호가 비면 파일을 쓰지 않고 1 을 돌려준다. 그 신호를
    # 그대로 배포 중단으로 쓴다. 평문이 나가는 일은 어떤 경우에도 막는다.
    if rc:
        say("\n■ 빌드가 정상으로 끝나지 않았습니다. 배포하지 않습니다.")
        return rc

    if args.dry_run:
        say("\n(dry-run) 여기까지. 커밋·푸시하지 않았습니다.")
        return 0

    # ── 5. 내용이 실제로 바뀌었는가 ─────────────────────────────────
    say("\n④ 내용 비교")
    clients, _ = bc.fetch_clients(bc.Notion(os.environ["NOTION_TOKEN"].strip()), slug)
    password = (clients[0].get("password") or "") if clients else ""

    enc_path = ROOT / "c" / f"{slug}.enc"
    new = stable(decrypt(json.loads(enc_path.read_text(encoding="utf-8")), password))
    head = head_envelope(slug)
    old = stable(decrypt(head, password)) if head else None

    if old is None:
        say("   이전 배포본을 읽지 못했습니다 — 바뀐 것으로 봅니다.")
        changes = ["첫 배포"]
    elif old == new:
        # 봉투 바이트만 다르다. 되돌려 커밋거리를 만들지 않는다.
        git("checkout", "--", f"c/{slug}.enc")
        left = [p for p in changed_paths() if owns(p, slug)]
        if not left:
            say("   바뀐 내용이 없습니다 — 커밋하지 않았습니다.")
            say(f"\n갱신 없음 / 배포 0곳 / {slug}")
            return 0
        say("   payload 는 그대로인데 산출물이 바뀌었습니다:")
        for p in left[:10]:
            say(f"     {p}")
        changes = ["화면 · 자산 변경"]
    else:
        changes = section_diff(old, new) or ["내용 변경"]
        say("   " + " · ".join(changes))

    # ── 6. 배포 ─────────────────────────────────────────────────────
    mine = [p for p in changed_paths() if owns(p, slug)]
    if not mine:
        say("\n커밋할 것이 없습니다.")
        return 0

    say("\n⑤ 배포")
    git("add", "--", *mine)
    git("commit", "-m", f"{slug} 갱신 — {' · '.join(changes)}")
    git("pull", "--rebase")
    git("push")
    say(f"   {bc.page_url(slug)}")
    say(f"\n갱신 {' · '.join(changes)} / 배포 1곳 / {slug}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
