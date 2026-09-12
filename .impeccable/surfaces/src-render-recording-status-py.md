---
version: 1
slug: "src-render-recording-status-py"
primary_target: "src/render_recording_status.py"
related_targets: ["src/process_recordings.py"]
---

Scope: PM이 통화녹음 자동화의 처리 상태를 개발 도구 없이 확인하는 로컬 전용 현황 화면. Mode: Operate.
THESIS: PM이 터미널 대신 한 장의 처리 장부에서 멈춘 녹음과 공개 승인 대기를 먼저 발견한다.
OWN-WORLD: 기존 GrowthHigh의 중성 바탕, 얇은 경계, 보라 포인트를 유지한다. 확인 필요는 절제된 적색, 승인 대기는 황색, 완료는 녹색으로 구분하며 장식 카드나 관리자 chrome은 더하지 않는다.
STORY: 마지막 자동 확인 시각 확인 → 확인 필요 여부 파악 → 승인 대기 초안을 Notion에서 검토 → 완료된 고객 반영 확인. 다음 예약 실행 후 90분까지 갱신이 없으면 예약 작업 지연 경고를 먼저 보여 준다.
FIRST VIEWPORT: 큰 `자동화 현황` 제목, 매일 09:00·13:00·18:00 일정, 상태별 건수, 마지막 확인 시각과 우선순위 장부가 한 화면에 온다.
STATE: `확인 필요·승인 대기·처리 중·완료` 네 상태를 제공한다. 확인 필요는 Codex에 전달할 짧은 복구 문구를, 승인 대기는 허용된 Notion 초안 링크를 보여 준다. 오래된 실행은 건강 상태 문구를 `현재 처리 상태를 확인할 수 없습니다`로 바꾸고, 건수 앞에 `마지막 저장 기준`을 붙이며, 별도 경고 띠에 `자동화 확인 필요` 복구 지시를 보여 준다.
PRIVACY: HTML은 Windows 사용자 계정의 LocalAppData에만 저장한다. 음성, 전사, 회의록 본문은 넣지 않으며 파일명·고객사·일자·처리 단계와 짧은 오류만 표시한다.
RESPONSIVE: 데스크톱은 상태·내용·갱신 시각의 3열 장부, 680px 이하는 단일 열이다. 390px에서 문서 가로 넘침이 없어야 한다.
FORM: `local-extension-direct` — 기존 운영 화면의 좁은 코드 주도 확장이라 concept seed를 적용하지 않는다.
FINISH: Python 전체 테스트, 실제 로컬 장부 렌더, 데스크톱·390px 모바일 fresh/overdue 상태 검수와 독립 finish review를 통과해야 완료다.
UNRESOLVED: 원본 녹음·전사본·회의록 초안의 보존기간과 삭제 책임자는 다음 P0에서 확정한다.
