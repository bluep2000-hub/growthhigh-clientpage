# 녹음 자동화 — 다른 PC 인수인계 (2026-10-12)

## 저장소와 업로드 범위

같은 상위 폴더에 두 저장소를 둔다. 없는 경우에만 clone하고, 이미 있다면 해당 저장소에서 로컬 변경을 확인한 뒤 `git pull --ff-only`로 갱신한다. 변경이 있으면 덮어쓰거나 reset하지 않는다.

```sh
git clone https://github.com/bluep2000-hub/growthhigh-clientpage.git
git clone https://github.com/bluep2000-hub/meeting-automation.git
```

이번 인수인계는 녹음 자동화와 공개 OAuth 페이지에 한정한다. 같은 작업 폴더에서 별도로 진행 중인 Hub 화면 개편과 고객별 제작 자료는 포함하지 않는다. 새 PC에 `.env`, OAuth 토큰, 녹음/전사문, 실제 고객 폴더 캐시, 처리 장부가 자동 전달되지 않는다. 서버 운영에 필요한 기존 인증과 상태는 VPS에 이미 있으며 다시 생성할 필요가 없다.

## 완료된 구현과 마지막 확인

- Galaxy FolderSync → VPS SFTP → 고객별 공유 Drive → Gemini → Notion → 고객페이지 직접 저장 경로가 연결됐다. `/ops/communications`는 소통과 연결된 할 일만 갱신하고 기존 공지·일정·이미지를 보존한다. 전체 페이지 `/ops/rebuild` 실행기는 별도다.
- 날짜 폴더 `yyyyMMdd_HHmmss_SSS` 한 단계 및 평면 업로드를 받는다. 같은 SHA-256 내용은 중복 처리하지 않으며, 다른 내용의 같은 이름은 서버 보관본에 `_2`, `_3`을 자동으로 붙인다. 고객 라벨의 자동 ` (1)`도 허용한다. 폰에서 이미 덮어쓴 파일을 복구하는 기능은 아니다.
- 매 회차 실제 고객 Drive 폴더 ID를 조회하고 Notion 원본 URL을 해당 고객 폴더로 만든다. 모호하거나 없는 연결은 중단한다. 기존 SHA 표식은 고객/일자/유형 확인 후 URL만 교정하고 Gemini/Notion 생성은 반복하지 않는다.
- 2026-10-08 VPS 배포 후 소스 지문 5/5, 합성 검사 22개, 성공 회차/exit 0 및 타이머 active를 확인했다. 당시 로컬 관련 검사 57개 통과, Windows 심볼릭 링크 생성 검사 1개 제외. 이 날짜 이후의 실제 서버 상태는 별도 조회해야 한다.
- Google Production 전환과 같은 계정·클라이언트·범위의 재인증, VPS의 실제 토큰 갱신과 폴더 조회를 확인했다. Google 앱 검증 완료나 장기간 인증 유지 관찰을 의미하지 않는다.
- 통화·고객 미팅 FolderSync 보존 설정은 사용자 `둘 다 했어`로 적용 확인했다. 실제 폰 화면/백그라운드/중복 이름 동작은 미검증이다. 설정은 [휴대폰 보존 안내](recording-phone-preservation.md)를 따른다.

## 다음 PC에서 이어갈 작업

1. 이 문서와 인접 `meeting-automation/HANDOFF.md`의 최신 절을 읽는다. 하단 기록은 당시 이력이므로 최신 완료 상태를 되돌리지 않는다.
2. 기존 관리 경로로 VPS에 접속해 `growthhigh-recordings.timer`와 최근 `growthhigh-recordings.service` 결과를 확인한다. 타이머는 5분 간격이고 oneshot 서비스의 `inactive` 자체는 실패가 아니다. 기존 크롤러/API/DB/SFTP는 유지한다.
3. 다음 실제 업무 녹음에 `YYMMDD_등록고객사_통화` 또는 `YYMMDD_등록고객사_미팅`만 붙인다. 시간이나 번호를 수동으로 입력시키지 않는다. 통화 폴더는 `Recordings/Call`, 미팅은 `Recordings/Voice Recorder`, SFTP 목적지는 `/upload`다.
4. 해당 새 파일만 수신 → 고객 Drive → 신규 전사/요약 → 새 Notion → 고객페이지까지 확인한다. 오래된 완료 녹음을 재처리하지 않는다. 공개 라벨이 게시 의도이며 건별 추가 승인 단계는 없다. 내부 미팅 Notion 처리는 계속 보류한다.
5. PM 확대 전 Google 실제 권한과 콘솔 선언 범위 정합성/앱 검증, PM별 업로드 계정 운영을 마무리한다. `phone01` 인증을 모든 PM에게 공유하는 방식은 승인되지 않았다.

VPS 기준 경로는 `/srv/growthhigh-recordings`다. 실행 소스는 `pipeline/src`, Python은 `venv/bin/python`, 인증은 `pipeline/.env`와 `rclone.conf`, 고객 폴더 연결은 `state/drive-folders.json`에 있다. 비밀값·전사문·녹음 내용은 채팅이나 Git에 출력하지 않는다. 새 PC의 로컬 실행이 필요한 경우에만 인증을 별도로 안전하게 구성한다.

배포를 다시 해야 한다면 실행 중 회차가 끝날 때까지 기다린 뒤 녹음 타이머만 잠시 멈추고 원본을 보존한다. 이전 소스 복구본은 `/srv/growthhigh-recordings/deploy/preservation-8fw4mc8f/before.zip`이다. 실행 중 잠금을 삭제하지 않는다.

## 남은 검증

이번 GitHub 인수인계 검증은 Git에 올릴 스냅샷만 대상으로 수행했다. Python 관련 검사 72개 통과/Windows 심볼릭 링크 생성 검사 1개 제외, Worker 저장 검사 9개 통과, 공개 Pages 빌드·게이트웨이 검사 통과. 인접 저장소의 내부 라벨·Notion 중복 쓰기 방지 검사와 실제 인증값을 쓰지 않는 두 인증 입력 검사도 통과했다. Windows sandbox의 하드링크/의존성 접근 제한은 로컬 합성 검사에 한해서 권한을 조정해 재검증했다. 오늘 실서버 재배포나 새 녹음 처리는 실행하지 않았다.

새 실제 녹음의 전체 신규 처리, 폰 백그라운드 동기화 및 같은 이름 원본 보존은 아직 확인 전이다. 녹음 파일의 생성/수정 시각을 실제 통화 시작 시각으로 단정하지 않는다. 배터리 설정은 사용자 선택인 `최적화`를 유지한다. 별도 반복 녹음 테스트는 요구하지 않는다.
