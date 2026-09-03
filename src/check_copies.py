#!/usr/bin/env python3
"""사본이 지금 원본 템플릿에서 나온 것인지 검사한다.

`{슬러그}/index.html` 은 루트 `index.html` 을 복사하고 `__SLUG__` 한 줄만
주입한 것이다. 그 한 줄을 도로 걷어내면 그 사본을 만들 때의 루트가 나온다.
지금 루트와 비교하면 두 가지가 잡힌다.

  뒤처짐   루트가 그 뒤로 바뀌었는데 재빌드하지 않았다
  손댐     루트에 없는 내용이 사본에만 있다 — 사본을 직접 고쳤다

두 번째가 실제로 벌어진 적이 있다. 조달현황 디자인이 원본이 아니라 사본
하나에만 들어갔고, 아무도 모르는 채 여러 커밋이 지나갔다. 그동안 한 곳은
옛 화면이었고, 다른 한 곳은 재빌드 한 번이면 디자인을 잃는 상태였다.

git 을 보지 않는다. 빌드 산출물을 커밋하는 구조라 원본과 사본이 늘 같은
작업 트리 안에 있고, 그것만으로 판정이 된다.

    python src/check_copies.py
    python src/check_copies.py --quiet     # 문제 있는 것만 (배포 스크립트용)

문제가 하나라도 있으면 종료 코드 1 이다. publish.py 가 이걸로 배포를 멈춘다.
"""

from __future__ import annotations

import argparse
import difflib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLUG_RE = re.compile(r'window\.__SLUG__="([^"]+)"')

OK, STALE, EDITED, FORKED, UNKNOWN = "최신", "뒤처짐", "손댐", "갈라짐", "확인불가"
MISMATCH = "이름불일치"


def read_raw(path: Path) -> str:
    """줄바꿈을 원본 그대로 읽는다. 빌더도 이렇게 읽으므로 맞춰야 한다."""
    with path.open(encoding="utf-8", newline="") as f:
        return f.read()


def tracked_pages() -> list[Path] | None:
    """git 이 추적하는 `*/index.html` 만 돌려준다. 없으면 None.

    검사 대상은 「배포되는 것」이다. `_verify/` 처럼 .gitignore 에 든 작업용
    폴더는 push 되지 않으므로 세면 안 된다. glob 은 그걸 못 가린다.
    """
    try:
        r = subprocess.run(["git", "ls-files", "*/index.html"],
                           cwd=ROOT, capture_output=True, text=True,
                           encoding="utf-8", timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    return [ROOT / line for line in r.stdout.splitlines() if line.strip()]


def find_copies() -> list[tuple[str, Path]]:
    """`__SLUG__` 가 박힌 index.html 만 사본으로 본다.

    디렉터리 이름으로 찾지 않는다. `logo/` 처럼 index.html 이 없는 곳도 있고,
    앞으로 무엇이 늘지 알 수 없다. 주입 표시가 있는 파일만 사본이다.
    """
    pages = tracked_pages()
    if pages is None:                       # git 이 없으면 눈에 보이는 것만이라도 본다
        pages = sorted(ROOT.glob("*/index.html"))
        pages = [p for p in pages if not p.parent.name.startswith((".", "_"))]

    out = []
    for p in sorted(pages):
        if not p.exists():
            continue
        try:
            head = p.open(encoding="utf-8", errors="replace").read(200_000)
        except OSError:
            continue
        m = SLUG_RE.search(head)
        if m:
            out.append((m.group(1), p))
    return out


def strip_injection(copy_text: str, slug: str) -> str | None:
    """주입한 한 줄을 도로 걷어내 그 사본이 나온 루트를 복원한다.

    빌더가 넣는 모양 그대로를 되돌린다. 모양이 다르면 None 이다 — 옛 빌더가
    만들었거나 사람이 그 언저리를 건드린 것이므로, 추측해서 맞추지 않는다.
    """
    inject = f'<script>window.__SLUG__="{slug}";window.__BASE__="../";</script>'
    for nl in ("\r\n", "\n"):
        made = f"</main>{nl}{nl}{inject}{nl}<script>"
        if made in copy_text:
            return copy_text.replace(made, f"</main>{nl}{nl}<script>", 1)
    return None


def classify(root_text: str, recon: str) -> tuple[str, int, int]:
    """복원한 루트와 지금 루트를 줄 단위로 견준다.

    사본에만 있는 줄이 하나라도 있으면 「손댐」이다. 루트에만 있는 줄은
    「뒤처짐」이다. 둘 다면 갈라진 것이고, 재빌드하면 사본 쪽 내용이 사라진다.
    """
    if root_text == recon:
        return OK, 0, 0

    a, b = recon.splitlines(), root_text.splitlines()
    only_copy = only_root = 0
    for line in difflib.unified_diff(a, b, n=0, lineterm=""):
        if line.startswith("---") or line.startswith("+++") or line.startswith("@@"):
            continue
        if line.startswith("-"):
            only_copy += 1
        elif line.startswith("+"):
            only_root += 1

    if only_copy and only_root:
        return FORKED, only_root, only_copy
    if only_copy:
        return EDITED, only_root, only_copy
    return STALE, only_root, only_copy


ADVICE = {
    OK: "",
    STALE: "재빌드하면 맞춰진다",
    EDITED: "사본에만 있는 내용이다. 원본에 옮긴 뒤 재빌드한다",
    FORKED: "재빌드하면 사본 쪽 내용이 사라진다. 먼저 원본에 옮긴다",
    UNKNOWN: "주입 모양이 달라 복원하지 못했다. 재빌드로 다시 만든다",
    MISMATCH: "폴더 이름과 슬러그가 다르다. 이 주소는 남의 데이터를 읽는다",
}


def check(only: str | None = None) -> tuple[int, list[dict]]:
    """`only` 를 주면 그 폴더 하나만 본다. 배포 스크립트가 이렇게 쓴다.

    한 곳만 빌드할 때 다른 사본의 상태로 배포를 막으면 안 된다. 재빌드하지
    않는 사본은 이번 배포로 달라지지 않는다.
    """
    root_file = ROOT / "index.html"
    if not root_file.exists():
        print("루트 index.html 이 없습니다.", file=sys.stderr)
        return 2, []

    root_text = read_raw(root_file)
    rows = []
    for slug, path in find_copies():
        folder = path.parent.name
        if only and folder != only:
            continue
        row = {"folder": folder, "slug": slug, "root": 0, "copy": 0}

        # 폴더 이름이 곧 주소다. 슬러그와 다르면 그 주소는 다른 기업의
        # payload 를 내려받는다. 템플릿 비교보다 먼저 잡아야 한다.
        if folder != slug:
            rows.append({**row, "state": MISMATCH})
            continue

        recon = strip_injection(read_raw(path), slug)
        if recon is None:
            rows.append({**row, "state": UNKNOWN})
            continue
        state, only_root, only_copy = classify(root_text, recon)
        rows.append({**row, "state": state, "root": only_root, "copy": only_copy})

    if only and not rows:
        print(f"{only}/index.html 을 찾지 못했습니다.", file=sys.stderr)
        return 2, []

    bad = sum(1 for r in rows if r["state"] != OK)
    return (1 if bad else 0), rows


def report(rows: list[dict], quiet: bool) -> None:
    shown = [r for r in rows if r["state"] != OK] if quiet else rows
    if not shown:
        if not quiet:
            print("사본이 없습니다.")
        return

    w = max(len(r["folder"]) for r in shown)
    for r in shown:
        line = f"  {r['folder']:<{w}}  {r['state']}"
        if r["state"] == MISMATCH:
            line += f"  (슬러그 {r['slug']})"
        if r["state"] != OK:
            detail = []
            if r["root"]:
                detail.append(f"루트에만 {r['root']}줄")
            if r["copy"]:
                detail.append(f"사본에만 {r['copy']}줄")
            if detail:
                line += "  (" + " · ".join(detail) + ")"
            line += f" — {ADVICE[r['state']]}"
        print(line)


def main() -> int:
    ap = argparse.ArgumentParser(description="사본이 원본 템플릿과 맞는지 검사")
    ap.add_argument("--quiet", action="store_true",
                    help="문제 있는 것만 출력한다 (배포 스크립트용)")
    ap.add_argument("--slug", metavar="슬러그", default=None,
                    help="그 폴더 하나만 검사한다")
    args = ap.parse_args()

    rc, rows = check(args.slug)
    if rc == 2:
        return 2

    if not args.quiet:
        print(f"사본 {len(rows)}개 검사")
    report(rows, args.quiet)

    if rc:
        n = sum(1 for r in rows if r["state"] != OK)
        print(f"\n■ {n}건이 원본과 맞지 않습니다. 배포 전에 정리하세요.")
    elif not args.quiet:
        print("\n모두 지금 원본 템플릿에서 나온 것입니다.")
    return rc


if __name__ == "__main__":
    sys.exit(main())
