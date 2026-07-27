# growthhigh-clientpage

클라이언트가 자기 진행 현황을 보는 페이지. 노션에 있는 내용을 모아 클라이언트별로
암호화한 JSON 을 만들고, GitHub Pages 로 서빙한다.

빌드 스크립트(`src/build_client.py`)와 배포 산출물이 같은 레포에 들어 있다.

---

## 디렉터리

```
src/build_client.py    빌더. 노션·Firestore·정책정보를 모아 .enc 를 만든다
src/requirements.txt   의존성

index.html             화면 전부. 데이터는 전부 .enc 에서 온다
{슬러그}/index.html      클라이언트별 진입점. 루트 index.html 사본 + __SLUG__ 주입
c/{슬러그}.enc           암호화된 데이터. 빌더가 만든다
logo/{슬러그}.png        노션 페이지 아이콘을 내려받은 것. 빌더가 만든다
assets/                잠금 화면에 쓰는 그로스하이 로고

.env                   NOTION_TOKEN. 커밋하지 않는다
.env.example           자리표시자
```

`index.html` 은 손으로 관리한다. 빌더는 건드리지 않는다.

---

## 준비

```bash
pip install -r src/requirements.txt
cp .env.example .env      # NOTION_TOKEN 을 채운다
```

노션 인테그레이션이 아래 넷에 연결돼 있어야 한다.

| DB | ID |
|---|---|
| 공유페이지 (클라이언트 레지스트리) | `21e815d7-12b9-80dc-8310-d038abd8a502` |
| 기업 | `67e04cfc-4033-4465-ae05-1ab6bf774627` |
| 프로젝트 | `e1d03e45-f7f9-42c1-88f8-7f4595efe2a1` |
| 공지 | 공유페이지 DB 의 `공지 DB` URL 에서 뽑는다 (하드코딩 없음) |

---

## 실행

```bash
python src/build_client.py                    # 전체
python src/build_client.py --client whiffkorea # 한 곳만
python src/build_client.py --dry-run          # 파일을 쓰지 않는다
python src/build_client.py --no-include-expired  # 마감 지난 추천·일정 제외
```

빌더가 만드는 것: `c/{슬러그}.enc`, `logo/{슬러그}.*`, `{슬러그}/index.html`.
전부 임시 파일에 쓴 뒤 교체하므로 도중에 죽어도 기존 파일이 깨지지 않는다.

**클라이언트가 늘어나려면** 공유페이지 DB 행에 `페이지 유형 = 👨‍💼클라이언트페이지`,
`슬러그`, `기업 DB` 릴레이션, `비밀번호_해시`(실제로는 평문 비밀번호)가 있어야 한다.
셋 중 하나라도 비면 경고를 남기고 건너뛴다 — 현재 위프코리아 한 곳만 빌드되는 이유다.

---

## 로컬 확인

```bash
python -m http.server 8000
```

`http://localhost:8000/whiffkorea/` 로 연다.
`file://` 로 열면 CORS 때문에 `fetch` 가 막혀 데이터를 못 읽는다.

---

## 데이터가 어디서 오는가

| 화면 | 원천 |
|---|---|
| 기업 정보 | 기업 DB 페이지 |
| 공지사항 | 공유페이지 DB 의 `공지 DB` URL → 최신 1건의 블록 트리 |
| 진행 현황 | 프로젝트 DB, `고객사 정보` 릴레이션으로 필터 |
| 추천 지원사업 | Firestore `playlists/{기업명}` + `growthhigh-policy/data-full.json` |
| 일정 | 위 JSON 안의 날짜(프로젝트 종료 예정일 + 추천 마감일)로 만든다 |
| 로고 | 공유페이지 DB 행의 페이지 아이콘을 내려받아 저장 |

프로젝트는 **페이지 본문을 읽지 않는다.** 팀 내부 지침 템플릿이 들어 있다.
읽는 속성은 프로젝트명·유형·상태·진행기간·최신로그 다섯뿐이다.

`CALENDAR_ICS_URL` 을 채우면 일정에 세 번째 원천이 붙는다. 비어 있으면 조용히 건너뛴다.

---

## 암호화

`.enc` 는 브라우저 WebCrypto 가 푸는 봉투다.

```
PBKDF2-HMAC-SHA256 200,000회 (salt 16B) → AES-GCM 256bit (IV 12B) → base64
```

비밀번호는 공유페이지 DB 의 `비밀번호_해시` 값이다. 이름과 달리 평문이 들어 있고,
그 값을 그대로 키 유도에 쓴다. 비어 있으면 `enc:false` 봉투에 평문을 담고
빌드 끝에 경고를 띄운다 — **그 상태로는 배포하면 안 된다.**

JSON 을 그냥 올리면 URL 만 알면 내용이 다 보이므로 암호화한다.

---

## 부분 실패

한 곳이 죽어도 전체를 죽이지 않는다.

| 상황 | 동작 |
|---|---|
| 노션 429/5xx | 지수 백오프 3회 재시도 |
| 노션 404 | 재시도 없이 즉시 실패 |
| 특정 클라이언트 실패 | 그 클라이언트만 건너뛰고 계속 (종료 코드 1) |
| Firestore 실패 | `recommend=[]` + 경고 |
| 공지 URL 없음·파싱 실패 | `notice=null` + 경고 |
| 로고 실패 | `logo=null` + 경고 |
| 매핑에 없는 값 | 기본값 + 경고 |
