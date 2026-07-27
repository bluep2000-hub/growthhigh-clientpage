#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""다우오피스 메일을 IMAP 으로 읽을 수 있는지 점검한다.

읽기만 한다. SELECT 는 readonly 로 열고 FETCH 는 BODY.PEEK 을 쓰므로
읽음 표시가 붙거나 메일이 지워지지 않는다. 본문·첨부는 건드리지 않는다.

    python src/check_imap.py

접속 정보는 .env 의 IMAP_HOST / IMAP_USER / IMAP_PASS 에서 읽는다.
비밀번호는 화면에도 로그에도 남기지 않는다.
"""

from __future__ import annotations

import base64
import imaplib
import os
import re
import sys
from email import message_from_bytes
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime, parseaddr
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent

IMAP_PORT = 993
TIMEOUT = 30
RECENT = 5

# 헤더만 가져온다. PEEK 이라 \Seen 이 붙지 않는다.
HEADER_FIELDS = "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])"

LOGIN_HINT = "관리자가 IMAP을 차단했을 수 있습니다"


# ══════════════════════════════════════════════════════════════════════════
# 출력
# ══════════════════════════════════════════════════════════════════════════

FAILED = False


def ok(label: str, detail: str = "") -> None:
    print(f"[OK]   {label}" + (f" — {detail}" if detail else ""), flush=True)


def fail(label: str, err: object, hint: str = "") -> None:
    global FAILED
    FAILED = True
    print(f"[FAIL] {label} — {err}", flush=True)
    if hint:
        print(f"       ↳ {hint}", flush=True)


# ══════════════════════════════════════════════════════════════════════════
# 디코딩
# ══════════════════════════════════════════════════════════════════════════

def imap_utf7_decode(s: str) -> str:
    """메일함명은 수정 UTF-7(RFC 3501)이다.

    표준 UTF-7 과 달리 '+' 자리에 '&', '/' 자리에 ',' 를 쓴다.
    「&x4wg7TDsA-」 → 「받은메일함」 같은 이름이 여기서 풀린다.
    """
    if "&" not in s:
        return s
    out: list[str] = []
    i = 0
    while i < len(s):
        if s[i] != "&":
            out.append(s[i])
            i += 1
            continue
        j = s.find("-", i)
        if j < 0:                       # 닫는 '-' 가 없다 — 원문을 그대로 둔다
            out.append(s[i:])
            break
        chunk = s[i + 1:j]
        if not chunk:
            out.append("&")             # '&-' 는 리터럴 '&'
        else:
            b64 = chunk.replace(",", "/")
            b64 += "=" * (-len(b64) % 4)
            try:
                # validate=True 가 없으면 알파벳 밖 문자를 조용히 버려서
                # 깨진 이름이 빈 문자열로 사라진다
                out.append(base64.b64decode(b64, validate=True).decode("utf-16-be"))
            except Exception:           # noqa: BLE001 — 못 풀면 원문을 보여준다
                out.append(s[i:j + 1])
        i = j + 1
    return "".join(out)


def decode_mime(raw: str | None) -> str:
    """=?UTF-8?B?...?= 형태의 인코딩 헤더를 사람이 읽는 문자열로."""
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw))).strip()
    except Exception:                   # noqa: BLE001 — 깨진 헤더는 원문 그대로
        return raw.strip()


# LIST 응답: (\HasNoChildren) "/" "INBOX"
LIST_RE = re.compile(r'^\([^)]*\)\s+(?:"[^"]*"|NIL)\s+(?P<name>.+)$')


def mailbox_name(line: bytes | tuple) -> str | None:
    if isinstance(line, tuple):         # 리터럴로 온 경우
        line = b" ".join(x for x in line if isinstance(x, bytes))
    if not isinstance(line, bytes):
        return None
    m = LIST_RE.match(line.decode("ascii", "replace").strip())
    if not m:
        return None
    name = m.group("name").strip()
    if name.startswith('"') and name.endswith('"'):
        name = name[1:-1]
    return imap_utf7_decode(name)


def fmt_date(raw: str | None) -> str:
    if not raw:
        return "—"
    try:
        return parsedate_to_datetime(raw).strftime("%Y-%m-%d %H:%M")
    except Exception:                   # noqa: BLE001
        return raw.strip()


def fmt_from(raw: str | None) -> str:
    name, addr = parseaddr(raw or "")
    name = decode_mime(name)
    return f"{name} <{addr}>" if name else (addr or "—")


# ══════════════════════════════════════════════════════════════════════════
# 점검
# ══════════════════════════════════════════════════════════════════════════

def main() -> int:
    load_dotenv(ROOT / ".env")
    host = os.environ.get("IMAP_HOST", "").strip()
    user = os.environ.get("IMAP_USER", "").strip()
    password = os.environ.get("IMAP_PASS", "")

    missing = [k for k, v in (("IMAP_HOST", host), ("IMAP_USER", user),
                              ("IMAP_PASS", password)) if not v]
    if missing:
        fail("환경변수", f"{', '.join(missing)} 가 비어 있습니다",
             ".env 를 확인하세요 (.env.example 참고)")
        return 1

    print(f"대상: {user} @ {host}:{IMAP_PORT} (SSL)\n")

    # 1. 서버 연결
    try:
        M = imaplib.IMAP4_SSL(host, IMAP_PORT, timeout=TIMEOUT)
    except Exception as e:              # noqa: BLE001
        fail("서버 연결", f"{type(e).__name__}: {e}")
        return 1
    ok("서버 연결", f"{host}:{IMAP_PORT}")

    try:
        # 2. 로그인
        try:
            M.login(user, password)
        except Exception as e:          # noqa: BLE001
            fail("로그인", f"{type(e).__name__}: {e}", LOGIN_HINT)
            return 1
        ok("로그인", user)

        # 3. 메일함 목록
        try:
            typ, data = M.list()
            if typ != "OK":
                raise imaplib.IMAP4.error(f"LIST 응답 {typ}")
            names = [n for n in (mailbox_name(x) for x in data or []) if n]
            ok("메일함 목록", f"{len(names)}개")
            for n in names:
                print(f"         · {n}")
        except Exception as e:          # noqa: BLE001
            fail("메일함 목록", f"{type(e).__name__}: {e}")

        # 4. INBOX 선택 — readonly 라 읽음 처리가 되지 않는다
        try:
            typ, data = M.select("INBOX", readonly=True)
            if typ != "OK":
                raise imaplib.IMAP4.error((data[0] or b"").decode("utf-8", "replace"))
            total = int(data[0])
        except Exception as e:          # noqa: BLE001
            fail("INBOX 선택", f"{type(e).__name__}: {e}")
            return 1
        ok("INBOX 선택", f"전체 {total:,}통 (readonly)")

        # 5. 최근 5건의 헤더만
        if total == 0:
            ok(f"최근 {RECENT}건", "메일함이 비어 있습니다")
            return 1 if FAILED else 0

        try:
            ids = [str(i) for i in range(total, max(0, total - RECENT), -1)]
            print(f"[OK]   최근 {min(RECENT, total)}건 (헤더만, 본문은 읽지 않음)")
            for mid in ids:
                typ, data = M.fetch(mid, HEADER_FIELDS)
                if typ != "OK" or not data or not isinstance(data[0], tuple):
                    print(f"         · #{mid} 헤더를 읽지 못했습니다")
                    continue
                msg = message_from_bytes(data[0][1])
                print(f"         · #{mid}  {fmt_date(msg.get('Date'))}")
                print(f"             보낸이: {fmt_from(msg.get('From'))}")
                print(f"             제목  : {decode_mime(msg.get('Subject')) or '(제목 없음)'}")
        except Exception as e:          # noqa: BLE001
            fail(f"최근 {RECENT}건", f"{type(e).__name__}: {e}")

    finally:
        try:
            M.close()                   # SELECT 한 메일함을 닫는다 (readonly라 EXPUNGE 없음)
        except Exception:               # noqa: BLE001
            pass
        try:
            M.logout()
        except Exception:               # noqa: BLE001
            pass

    print()
    if FAILED:
        print("점검 실패 — 위 [FAIL] 항목을 확인하세요.")
        return 1
    print("점검 통과 — IMAP 으로 메일을 읽을 수 있습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
