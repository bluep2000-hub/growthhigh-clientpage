# 중계 서버

```
https://growthhigh-clientpage-relay.growthhigh-clientpage-worker.workers.dev
```

클라이언트 페이지의 **편집 모드**가 노션에 쓸 때 거치는 서버다.
Cloudflare Workers 위에서 돈다.

## 왜 있나

클라이언트 페이지는 정적 파일이다. 브라우저에서 노션에 직접 쓰려면 노션
토큰을 화면에 실어야 하는데, 페이지 주소는 누구나 열 수 있으므로 그러면
워크스페이스 전체가 새어 나간다. 토큰은 여기에만 둔다.

자세한 결정은 `../docs/adr/0003-공지-전체-편집.md` 를 본다
(`0001` 은 그것이 대신한다).

## ⚠ 이 폴더는 웹에 서빙된다

레포 루트가 곧 GitHub Pages 배포물이다. `worker/` 에 넣은 파일은
`https://bluep2000-hub.github.io/growthhigh-clientpage/worker/...` 로
누구나 받을 수 있다.

**비밀값을 한 줄도 두지 않는다.** 커밋 여부와 무관하다 — 로컬 서버로도 새어
나간다. 소스 코드가 공개되는 것 자체는 무해하지만, 값은 아니다.

## 세팅

```bash
cd worker
npm install
```

비밀값은 Cloudflare 에 직접 넣는다. 파일에 적지 않는다.

```bash
npx wrangler secret put NOTION_TOKEN            # 노션 통합 토큰
npx wrangler secret put EDITOR_PASSWORD         # 담당자 공용 비밀번호
npx wrangler secret put GITHUB_DISPATCH_TOKEN   # 재빌드 신호용 (티켓 #14)
```

`EDITOR_PASSWORD` 는 **클라이언트 페이지 비밀번호와 다른 값**이어야 한다.
같으면 기업이 자기 공지를 고칠 수 있게 된다.

로컬에서 돌릴 때는 `.dev.vars` 에 넣는다 (`.gitignore` 에 있다).
`.dev.vars.example` 을 복사해 쓴다.

## ⚠ curl 로 시험하지 않는다

Windows 콘솔은 UTF-8 이 아니다. 한글이 든 값을 셸 변수에 담아 `curl` 로 보내면
**깨진 글자가 그대로 노션에 저장된다.** 실제로 한 번 그렇게 공지 한 줄을
깨뜨렸다(되돌렸다). 시험은 `python` 이나 `node` 로, 본문을 UTF-8 바이트로
직접 만들어 보낸다.

## 자주 쓰는 명령

```bash
npm run dev        # 로컬 (http://localhost:8787)
npm test           # vitest
npm run deploy     # Cloudflare 에 올린다
```

## 창구

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/health` | 살아 있는지 |
| `POST` | `/auth` | 담당자 공용 비밀번호가 맞는지 |
| `GET` | `/notice/tree?slug=&more=` | 공지 전체를 편집용 글로 받아 간다 |
| `POST` | `/notice/save` | 고친 것을 한 번에 적용한다 |
| `GET` | `/notice/item?slug=&blockId=` | (옛 방식) 그 항목의 마크다운 |
| `PUT` | `/notice/item` | (옛 방식) 그 항목을 고친다 |
| `POST` | `/notice/item` | (옛 방식) 공지 맨 끝에 한 줄 보탠다 |
| `DELETE` | `/notice/item` | (옛 방식) 그 항목을 지운다 |

「옛 방식」 넷과 마크다운 변환은 화면이 새 방식으로 옮겨 간 뒤 티켓 #25 에서
지운다. 새로 붙이는 것은 `/notice/tree` 와 `/notice/save` 만 쓴다.

### 공지 전체를 읽는다 — `GET /notice/tree`

```
{ pageId, items: { "<블록 주소>": { type, last_edited_time, html?, checked?, locked? } },
  more: ["<아직 안 읽은 블록 주소>", ...] }
```

봉투에 실린 HTML 은 표시용이라 `rich_text` 로 되돌릴 수 없다. 편집 모드는
반드시 여기서 새로 읽는다. 여기서 받은 `last_edited_time` 이 저장할 때 보내는
`seen` 의 기준선이다 — **봉투의 시각을 쓰면 안 된다.** 그것은 빌드 시각이라,
지난 빌드 이후 노션에서 손댄 항목이 전부 어긋남으로 잡힌다.

구조는 주지 않는다. 화면은 봉투로 이미 공지를 그려 두었고, 주소로 짝을 맞춰
속만 갈아 끼운다.

`more` 가 비어 있지 않으면 아직 다 읽지 못한 것이다. 그 값을 쉼표로 이어
`?more=` 에 실어 다시 부른다. Cloudflare Workers 는 요청 하나가 낼 수 있는
바깥 호출 수에 상한이 있고(무료 50), 위프코리아 공지는 그 상한에 그대로 닿는다.

### 한 번에 저장한다 — `POST /notice/save`

```
{ slug, noticePageId?, changes: [ { op: "edit",  blockId, seen, html },
                                  { op: "check", blockId, seen, checked } ] }
```

```
{ pageId, saved, failed, rebuild,
  results: [ { index, blockId, status, html?, checked?, last_edited_time?,
               detail?, current? } ] }
```

| `status` | 뜻 |
|---|---|
| `ok` | 노션에 들어갔다. 새 `last_edited_time` 이 다음 저장의 기준선이다 |
| `stale` | 화면이 본 뒤에 노션에서 먼저 바뀌었다. **쓰지 않았다.** `current` 에 노션의 지금 내용 |
| `locked` | 잠긴 항목이다. `detail` 에 사유 |
| `failed` | 그 변경만 실패했다. `detail` 에 사유 |

하나가 실패해도 나머지는 간다. 전부 취소인 척하지 않는다 — 노션에 되돌리기가
없어 거짓말이 된다. **남의 기업 블록 주소가 섞여 오면** 아무것도 쓰지 않고
통째로 `404 not_mine` 이다.

재빌드 신호는 **하나라도 성공했을 때 한 번만** 나간다.

### 비밀번호를 싣는 법

```
Authorization: Bearer <base64(UTF-8(담당자 공용 비밀번호))>
```

**그냥 넣으면 안 된다.** HTTP 헤더는 바이트 하나가 한 글자라, 비밀번호에 한글이
있으면 브라우저가 요청을 만들다가 던진다. 화면에서는 이렇게 만든다.

```js
btoa(String.fromCharCode(...new TextEncoder().encode(password)))
```

### 실패

| 상태 | 언제 |
|---|---|
| `401` | 비밀번호가 없거나 틀리다 |
| `404` | 모르는 슬러그 · 공지 항목이 아닌 블록 (`not_found`) · 그 기업 공지 밖의 blockId (`not_mine`) |
| `409` | 잠긴 항목 (옛 창구만. `/notice/save` 는 결과 목록에 `locked` 로 담는다) |
| `422` | 닫히지 않은 표시, 빈 내용, 빠진 값 |
| `502` | 노션이 실패했다 |

### 서식 — 새 방식

`rich_text` 와 **편집용 HTML** 로 왕복한다. 화면이 만들 수 있는 것은 태그로
싣는다.

```
<strong> <em> <u> <s> <code> <a href> <br> <span data-c="색이름">
```

화면이 만들 수 없는 것(멘션·수식)은 **불투명 조각**으로 싣는다.

```
<span data-o="지금 rich_text 에서의 자리">보이는 글</span>
```

화면은 여기에 손대지 않고 그대로 돌려준다. 서버는 저장 직전에 그 블록을 다시
읽어 같은 자리의 조각을 그대로 쓴다. 안쪽 글이 달라져 오면 거절한다.

이 왕복이 무손실인지는 두 번 확인했다. 붙박이 테스트가 **77개 항목**으로
매번 확인하고(`test/fixtures/notice-runs.js` — 실제 공지에서 모양만 뜨고 글자는
지운 64개 + 손으로 지은 짓궂은 13개), 만들 때 한 번은 **가리지 않은 실제 공지
124개 항목**으로도 확인했다. 잠기는 것은
**링크 카드**(`link_preview`·`link_mention`)와 **하위 문서** 둘뿐이다 —
노션이 쓰기를 받지 않는다. 표·첨부·그림·코드·구분선은 아직 다루는 코드가
없어 잠겨 있고, 티켓 #26·#27 이 연다.

### 서식 — 옛 방식 (`/notice/item`)

`**굵게**` · `~~취소선~~` · `` `코드` `` 셋뿐이다. `\` 를 앞에 붙이면 표시가
아니라 글자로 읽는다. 그 밖의 서식이 든 항목은 **잠긴 항목**이라 아예 열리지
않는다 — 고치면 노션 쪽에서 사라지기 때문이다.

`GET` 이 주는 글은 **노션에 있는 그대로**다. 화면에 보이는 글과 다를 수 있다
(빌드가 후행 콜론을 뗀다). 보이는 대로 저장하면 그만큼 사라지므로, 입력칸은
반드시 `GET` 이 준 글로 채운다.
