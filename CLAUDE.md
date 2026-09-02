# growthhigh-clientpage

노션을 읽어 클라이언트별 정적 페이지를 만드는 저장소다.
빌드 산출물을 그대로 커밋해 GitHub Pages 로 내보낸다. 레포 루트가 곧 배포물이다.

## 처음 세팅

```bash
pip install -r src/requirements.txt
cp .env.example .env
```

레포에 없는 것은 `.env` 하나뿐이다. `NOTION_TOKEN` 만 채우면 빌드가 끝까지 돈다.

| 키 | 없을 때 |
|---|---|
| `NOTION_TOKEN` | 빌드 불가 |
| `CALENDAR_ICS_URL` | 일정에서 미팅이 빠진다 |
| `IMAP_HOST` · `IMAP_USER` · `IMAP_PASS` | `--skip-imap` 으로 우회한다. 기존 소통 내역은 노션에서 읽는다 |
| `OWN_MAIL_EXTRA` · `GOOGLE_APPLICATION_CREDENTIALS` | 선택이다 |

## 자주 쓰는 명령

```bash
git pull                                          # 작업 전 반드시 먼저
python src/build_client.py --skip-imap            # 조건을 갖춘 클라이언트 전부
python src/build_client.py --client 슬러그 --skip-imap   # 한 곳만
python src/build_client.py --client 슬러그 --dry-run     # 파일도 노션도 건드리지 않고 확인만
python -m http.server 8000 --bind 127.0.0.1       # 로컬 확인
```

`--bind 127.0.0.1` 을 빼면 레포 루트가 같은 네트워크에 통째로 열린다.

## 새 클라이언트 추가

코드를 고칠 일이 없다. 노션에서 속성을 채우고 빌드를 돌리면
`c/{슬러그}.enc` · `{슬러그}/index.html` · `logo/{슬러그}.*` 가 자동으로 생긴다.

### 1. 노션 — 공유페이지 DB

「페이지 유형」에 `👨‍💼클라이언트페이지` 가 든 행이 대상이다.

빌드 대상이 되는 조건은 **둘**이다. 하나라도 비면 경고를 남기고 건너뛴다.

- `슬러그` — 주소가 된다. 영문 소문자·숫자·하이픈만 쓴다
- `기업 DB` 릴레이션 — 기업명·사업내용·주소가 여기서 온다

`비밀번호_해시` 는 빌드를 막지 않는다. 비어 있으면 **암호화 없이 평문으로**
만들어지고 빌드 끝에 경고가 뜬다. 이름과 달리 평문 비밀번호를 넣는다.

선택 속성이다.

- `공지 DB` (URL) — 없으면 공지 화면이 빈 상태다
- `드라이브 URL` · `사업계획서 URL` — 없으면 좌측 「자료」 항목이 흐려진다
- 페이지 아이콘 — 로고로 쓴다. 없으면 기업명 앞 두 글자를 대신 넣는다

프로젝트와 일정은 따로 지정하지 않는다.
프로젝트 DB 의 `고객사 정보` 가 그 기업 페이지를 가리키면 자동으로 붙고,
캘린더는 일정 제목이 `[기업명]` 으로 시작하면 자동으로 잡힌다.

### 2. 빌드

```bash
python src/build_client.py --client 새슬러그 --skip-imap
```

끝에 **`⚠ 배포하지 마세요` 경고가 없는지 확인한다.** 이 경고가 있으면
비밀번호가 비어 데이터가 평문으로 나간 것이다. 노션에 비밀번호를 넣고 다시 빌드한다.

### 3. 배포

```bash
git add -A && git commit -m "새슬러그 추가" && git push
```

1~2분 뒤 `https://bluep2000-hub.github.io/growthhigh-clientpage/{슬러그}/` 로 열린다.

## 반드시 지킬 것

**작업 전 `git pull`.** 빌드 산출물을 커밋하는 구조라 두 PC 에서 같은 클라이언트를
빌드하면 충돌한다.

**루트 `index.html` 을 고쳤으면 반드시 재빌드.** `{슬러그}/index.html` 은 루트
`index.html` 의 사본이다. 루트만 고치고 push 하면 클라이언트 주소는 옛 화면 그대로다.
빌드가 사본을 다시 만들어 준다.

빌드가 `index.html 에서 주입 지점을 찾지 못했습니다` 경고를 내면 사본이 아예
만들어지지 않은 것이다. 빌드는 `</main>` 다음 빈 줄 다음 `<script>` 를
주입 지점으로 쓴다. 그 사이에 무엇을 끼워 넣으면 안 된다.

**서비스 계정 키·비밀키를 레포 안에 두지 않는다.** 레포 루트는 통째로 웹에 서빙된다.

## 코드가 기대하는 노션 속성명

이름을 바꾸면 조용히 빈 값이 된다.

| DB | 속성 |
|---|---|
| 공유페이지 | `페이지명` `슬러그` `기업 DB` `담당자` `업종` `비밀번호_해시` `공지 DB` `드라이브 URL` `사업계획서 URL` |
| 기업 | `기업명` `사업내용` `주소` `설립연월` `업종분류` `인증ㅣ특허` |
| 프로젝트 | `프로젝트명` `프로젝트 유형` `프로젝트 상태` `진행기간` `최신로그` `확보금액` `고객사 정보` |
| 소통 내역 | `제목` `일자` `채널` `방향` `요약` `클라이언트` `상태` `Message-ID` |
| 공지 | `일자` + 제목(title 타입으로 찾으므로 이름은 상관없다) |

`인증ㅣ특허` 의 가운데 글자는 세로줄(`|`)이 아니라 한글 모음 `ㅣ` 이다.

## Agent skills

### Issue tracker

이슈는 이 레포의 GitHub Issues 에서 추적한다 (`gh` CLI). `docs/agents/issue-tracker.md` 참고.

### Triage labels

기본 5개 라벨을 그대로 쓴다 — `needs-triage` `needs-info` `ready-for-agent` `ready-for-human` `wontfix`. `docs/agents/triage-labels.md` 참고.

### Domain docs

single-context — 루트에 `CONTEXT.md` 하나, `docs/adr/` 하나. `docs/agents/domain.md` 참고.
