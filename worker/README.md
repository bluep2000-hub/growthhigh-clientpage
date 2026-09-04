# 중계 서버

클라이언트 페이지의 **편집 모드**가 노션에 쓸 때 거치는 서버다.
Cloudflare Workers 위에서 돈다.

## 왜 있나

클라이언트 페이지는 정적 파일이다. 브라우저에서 노션에 직접 쓰려면 노션
토큰을 화면에 실어야 하는데, 페이지 주소는 누구나 열 수 있으므로 그러면
워크스페이스 전체가 새어 나간다. 토큰은 여기에만 둔다.

자세한 결정은 `../docs/adr/0001-공지-항목-단위-편집.md` 를 본다.

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

공지 항목을 고치고 보태고 지우는 창구는 티켓 #11 · #13 에서 붙는다.
