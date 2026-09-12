#!/usr/bin/env python3
"""자동화 전용 토큰을 로컬 .env와 Cloudflare Worker에 안전하게 맞춘다.

토큰 값은 표준 출력이나 명령 인자에 넣지 않는다. 기존 로컬 값이 있으면 그대로
재사용하므로 Cloudflare 설정만 실패한 뒤 다시 실행해도 서로 다른 값이 생기지 않는다.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"


def ensure_local_token(path: Path = ENV_FILE) -> str:
    raw = path.read_bytes()
    newline = b"\r\n" if b"\r\n" in raw else b"\n"
    trailing_newline = raw.endswith((b"\r\n", b"\n"))
    lines = raw.splitlines()
    prefix = b"AUTOMATION_TOKEN="

    for line in lines:
        if line.startswith(prefix):
            existing = line[len(prefix):].strip().decode("ascii")
            if existing:
                return existing

    token = secrets.token_urlsafe(32)
    replacement = prefix + token.encode("ascii")
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            lines[index] = replacement
            break
    else:
        if lines and lines[-1]:
            lines.append(b"")
        lines.append(replacement)

    updated = newline.join(lines) + (newline if trailing_newline else b"")
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temp.write_bytes(updated)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)
    return token


def main() -> int:
    try:
        token = ensure_local_token()
    except (OSError, UnicodeError) as exc:
        print(f"로컬 자동화 키 저장 실패: {exc}")
        return 1

    command = ["npx.cmd" if os.name == "nt" else "npx",
               "wrangler", "secret", "put", "AUTOMATION_TOKEN"]
    result = subprocess.run(
        command,
        cwd=ROOT / "worker",
        input=token + "\n",
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).replace(token, "[숨김]")
        print(f"Cloudflare 자동화 키 저장 실패:\n{detail[-1000:]}")
        return 1
    print("자동화 전용 키를 이 PC와 Cloudflare에 동일하게 저장했다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
