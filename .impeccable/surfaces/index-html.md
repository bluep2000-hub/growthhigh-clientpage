---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["whiffkorea/index.html"]
---

Scope: 공지사항 편집 화면. Mode: Operate.
THESIS: 담당자가 공지 카드와 입력 폼을 다루는 느낌 없이, 제목에서 본문으로 곧장 내려가 한 장의 빈 문서를 쓰게 한다. 카드형 섹션 UI와 상시 노출된 관리 장치는 거부한다.
OWN-WORLD: 기존 GrowthHigh의 절제된 중성색과 포인트 색을 유지하되, 편집 화면은 중앙 820px 문서 캔버스, 큰 무테 제목, 보이지 않는 블록 경계, 포커스 시 나타나는 좌측 블록 손잡이로 구성한다.
STORY: 공지 열기 → 제목 입력 → Enter로 본문 이동 → Enter와 / 명령으로 내용 구성 → 자동저장 상태 확인 → 미리보기 또는 게시.
FIRST VIEWPORT: 얇은 sticky 문서 도구막대, 넉넉한 상단 여백, 38px 제목, 작은 공지일/게시 상태, 첫 빈 문단과 안내 placeholder가 보인다.
FORM: 사용자가 정확히 지정한 Notion 문서 편집 패턴을 따른다. 별도 콘셉트 탐색은 생략한다.
FINISH: structure, spacing, and usability pass complete — visual captures still pending.

## 소통 내역 주요 지정 확장

Scope: 소통 내역에서 담당자가 고객에게 먼저 보여 줄 항목을 지정·해제하는 편집 흐름. Mode: Operate.
THESIS: 우선순위 지정은 별도 관리자 화면이 아니라 기존 소통 장부에 주석을 다는 동작처럼 느껴져야 한다.
OWN-WORLD: 절제된 중성색의 Notion형 운영 UI를 유지한다. 작은 파란 별 하나만 새 강조로 쓰며 별도 관리자 카드, 툴바, 상태 패널을 더하지 않는다.
STORY: 담당자 인증 → 행 제목 앞 ☆/★ 토글 → 상단 주요 소통 즉시 갱신 → 저장 실패 시 원래 상태로 되돌리고 행 안에서 재시도. 고객은 저장이 확인된 ★ 항목만 본다.
FIRST VIEWPORT: 기존 제목과 필터 위치를 지킨다. 편집 모드 pill은 소통 건수 옆에 두고, 주요 소통은 채널 필터 위에 유지하며, 별은 행 제목 앞에 둔다. coarse pointer에서는 별 버튼의 터치 영역을 42px로 확장한다.
STATE: 담당자에게만 낙관적 토글과 저장 중 상태를 보여 준다. 실패는 해당 행 안에서 설명하고 재시도를 제공하며, 고객 화면과 캐시에는 확인된 상태만 반영한다.
FORM: 기존 장부의 좁은 코드 주도 확장이다. 별도 관리자 chrome이나 새로운 시각 세계를 만들지 않는다.
