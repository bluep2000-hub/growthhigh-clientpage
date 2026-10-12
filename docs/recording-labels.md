# 녹음 자동화 재구축 — 2026-10-08

## 같은 이름 보존·고객 Drive 링크 — 최신 서버 배포

- 사용자 `두 개발 모두 진행해` 요청으로 두 변경을 VPS에 배포했다. 기존 회차 종료 후 녹음 타이머만 잠시 중지해 5개 처리 소스와 이전 `app/` 공통 3개를 교체했다. 로컬 관련 검사 57개 통과/Windows 심볼릭 링크 검사 1개 제외, VPS 합성 검사 22개 모두 통과. 크롤러/API/DB/SFTP와 인증은 변경하지 않았다.
- 고객 Drive 접수함에서 등록 고객 16곳의 실제 폴더 ID를 확인했다. 서버가 매 회차 연결을 갱신하고 Notion URL은 해당 고객 폴더로 생성한다. 기존 위프코리아 고정 URL은 SHA256 복구 조회에만 호환하며 일치한 기존 기록의 URL만 교정한다.
- 배포 후 실제 서버 회차 success/exit 0 및 완료 로그/최근 traceback 없음, 타이머 active, 기존 API/DB healthy/SFTP 유지 확인. 로컬 Git 제외 폴더 연결 파일도 실제 16곳으로 저장했다. 이는 새 녹음의 신규 Notion 생성 검증과는 다르다.
- 날짜 폴더 `yyyyMMdd_HHmmss_SSS` 한 단계 수신과 기존 평면 수신을 모두 읽는다. 같은 내용은 재처리하지 않고 다른 내용의 같은 이름은 서버 보관본만 자동 구분한다. 자동 ` (1)` 고객 라벨도 허용한다. 수동 시간/번호 입력은 없다.
- **휴대폰 설정 적용 사용자 확인:** 2026-10-08 `둘 다 했어` 답변으로 통화·고객 미팅 두 FolderPair에 [보존 설정](recording-phone-preservation.md)을 적용했다고 확인했다. 별도 화면 검증이나 갤럭시 중복 이름 동작 검증은 아니다. 폰에서 이미 덮어쓴 녹음은 복구할 수 없고, 수정 시각 정렬과 전체 자동 처리는 별도 반복 테스트 없이 다음 실제 업무 녹음에서 확인한다.
- 이 절을 아래 이전 상태보다 우선한다. Google 운영 인증은 완료됐고 기존 인증 보존/실제 refresh/조회 확인은 인접 `meeting-automation/HANDOFF.md`에 기록했다. Google 권한 선언·앱 검증, 새 실제 녹음의 전체 신규 처리, PM별 계정 운영은 아직 남아 있다. 내부 미팅 Notion 처리 보류는 유지한다.

## 휴대폰 예약 업로드 설정 — 최신 (사용자 확인)

- 통화 FolderPair의 좌측은 `Recordings/Call`, 복사한 `고객 미팅 업로드`의 좌측은 `Recordings/Voice Recorder`다. 수신은 기존 SFTP `/upload`다.
- 포함 / 파일 이름 정규표현식은 통화 `^[0-9]{6}_[^_]+_통화\.m4a$`, 고객 미팅 `^[0-9]{6}_[^_]+_미팅\.m4a$`다. 기존 내부 미팅 필터는 사용자 요청으로 유지한다. 내부 미팅의 전사/Notion 자동화는 보류 상태다.
- 두 일정의 15분 예약, Wi-Fi·모바일 허용, 충전 조건 해제를 저장했다고 사용자가 확인했다. 통화의 임시 파일 사용도 켰다. 미팅은 통화 설정을 복사했으며 복사본의 임시 파일 옵션은 별도 화면으로 검증하지 않았다.
- 배터리는 사용자 선택으로 `최적화` 유지한다. 화면이 꺼진 상태의 실제 예약 실행은 아직 확인하지 않았다. 아래 이전 단계의 예약/일반 필터 활성화 보류 안내는 대체한다.
- 추가 반복 테스트를 요구하지 않고 다음 실제 업무 녹음에서 신규 전사→요약→Notion 생성→고객 화면을 확인한다. OAuth 7일 만료와 동일 이름의 폰/SFTP 원본 보존은 여전히 미해결이다.
- 설정 저장 뒤 실서버 상태 재확인: 최근 service 성공/exit 0, timer active, 장부 complete 1건/오류 0건, 고객 보관 녹음 1개. 신규 고객 녹음 수신 및 휴대폰 예약 실행의 증거는 아직 없다. 서버 서비스/인증 설정은 이번에 변경하지 않았다.

## 고객 소통의 VPS 직접 저장 검증 — 이전 단계 (15:30 KST)

- 녹음 후 고객페이지 반영에서 PC 의존성을 제거했다. 기존 `build_client.read_talks`, `public_talk`, `read_actions`를 VPS에서 사용하고, 기존 자동화 인증으로 Worker `/ops/communications`에 실제 저장한다. 추가 Cloudflare/BUILD_TOKEN을 VPS로 옮기지 않았다.
- 이 경로는 고객의 공개 소통과 연결된 할 일만 교체한다. 공지·프로젝트·일정 등 나머지 고객 데이터와 이미지에는 기존 정상 결과를 사용한다. 일반 전체 빌더/편집 큐(`/ops/rebuild`)는 별도이며 이번 작업으로 서버 실행기로 바뀌지 않았다.
- 실제 systemd 회차에서 기존 위프코리아 녹음을 페이지 반영 단계만 재실행: 신규 전사/요약/Notion 생성 없음, `고객 소통 저장 완료`, 소통 저장 1건/실패 0건/회차 성공. CPU 26.295초, 최고 RAM 72.6MiB. 장부는 요청 접수가 아닌 저장된 buildKey 확인 뒤 `complete` 처리한다.
- 원격 D1 최신 `ready=1`, 저장 시각 `2026-10-08T06:30:19.182Z`, 소통 47건, 대상 통화 1건. 이전 정상 결과와 소통/연결 할 일 외 데이터의 내용 일치 및 이미지 5개 전부 내용 일치를 확인했다. 실제 고객 브라우저 렌더는 이번에 검증하지 않았다.
- 회차 종료 `Result=success`, `ExecMainStatus=0`, 장부 complete 시각 `2026-10-08T06:30:19+00:00`. 5분 타이머 `enabled/active`, 다음 실행 `06:35 UTC` 확인. 기존 API/DB healthy와 web/SFTP/gateway 실행 유지 확인. 비밀 없는 증거 화면: `../meeting-automation/data/vps-communications-success.jpg` (Git 제외).
- Worker는 등록 고객/인증/고객명/본문 필드/크기/시각을 검증하고, 동시 전체 빌드와 충돌하면 기존 결과를 보존하고 재시도한다. 소통 수집 실패·본문 결손도 저장하지 않는다. 다른 고객의 등록 경고가 현재 고객 갱신을 막지 않도록 기존 빌더와 같은 경고 범위를 사용한다.
- 갱신 실패와 중단된 갱신은 다음 회차에 재시도한다. 페이지 저장 오류로 이미 끝난 Gemini 요약을 반복하지 않는다. 관련 Worker 11개, Python 8개 검사 통과.
- 다음 사용자 테스트: **기존 Notion 기록이 없는 새 위프코리아 통화 또는 미팅 한 개**를 승인 라벨로 업로드해 새 전사→요약→Notion 생성→실제 페이지 반영을 확인한다. 휴대폰은 아직 단일 파일 필터/수동 동기화이며 예약과 일반 필터는 켜지 않는다.
- OAuth External/Testing 7일 만료, 폰/SFTP의 동일 이름 원본 보존, 녹음 시각 메타데이터 운영 반영은 여전히 미완료다. 내부 미팅 작업은 보류한다.
- 배포 중 녹음 서비스 정지로 남은 잠금은 해당 PID 및 다른 파이프라인 프로세스가 없는 것을 확인한 뒤 `deploy/recording-lock-stopped.json`으로 보관했다. 실행 중 잠금을 제거하지 않는다. 기존 API/DB/SFTP는 중지하지 않았다. 코드/장부 복구본은 VPS `deploy/communications-backup.zip`, `deploy/jobs-before-communications.json`에 있다.

## 인증 이전 승인 및 실서버 검증 — 이전 단계

- 사용자가 VPS `187.52.115.145`로 기존 Gemini·Notion·고객페이지 갱신 인증키 3개를 이전하도록 명시적으로 승인했다. 앞선 자동 승인 검토의 차단 사유는 해소됐다.
- 서버 전용 RSA-OAEP SHA256으로 암호화해 이전했으며 `/srv/growthhigh-recordings/pipeline/.env`에 `600` 권한으로 저장했다. 키를 채팅·로그·Git에 출력하지 않았다. 일회용 개인키와 암호화 전달 파일은 정리했고 Drive 임시 파일은 휴지통으로 옮겼다.
- 서버에서 Gemini `gemini-3.8-flash` 및 `gemini-3.6-flash` 모델 조회 성공, Notion 고객 소통 DB 조회 HTTP 200 확인. 최초 Gemini 조회의 RuntimeError는 재조회 때 재현되지 않았다.
- 기존 `260827_위프코리아_통화.m4a` SHA256에 대응하는 Notion 기록을 서버에서 찾았고, 새 전사·요약·Notion 생성 없이 기존 기록에 연결했다. 15:06 KST 회차 `Result=success`, exit 0, 서버 장부 `complete` 1건. CPU 20.625초/최고 RAM 157.2MiB. 5분 타이머 재개 및 다음 실행 예약 확인.
- **고객페이지 갱신 실행기는 아직 PC 기반이다.** 서버 `/ops/rebuild` 호출은 성공했지만 D1 큐는 `requested`에 머물렀다. 이번 위프코리아 갱신만 기존 PC `worker/scripts/build-private.mjs --client=whiffkorea`로 실행해 해결했다. 원격 D1에서 큐 `completed`, 오류 없음, 최신 결과 `ready=1`, `saved_at=2026-10-08T06:09:01.799Z`, 대상 통화 1건만 포함 확인. 실제 브라우저 렌더 검증과 PC 없는 갱신은 아직이다.
- **다음 작업:** 기존 고객페이지 빌더/저장 흐름을 재사용해 서버의 Notion 등록 뒤 고객페이지까지 무인 갱신할 수 있게 연결한다. Cloudflare/BUILD_TOKEN 추가 인증을 임의로 VPS에 이전하지 않는다. 새 녹음 전사 및 공개 생성 테스트 전에 이 마지막 의존성을 해결한다.
- 새 녹음의 실제 Gemini 전사·요약·Notion 생성 검증은 아직이며, 휴대폰 예약과 일반 라벨 필터도 아직 활성화하지 않았다. Google OAuth External/Testing의 7일 수명 및 휴대폰/SFTP에서 같은 이름 보존 문제는 장기 운영 전 남은 항목이다.

## 서버 자동 처리 연결 작업 — 이전 단계

- 실서버 2026-10-08 14:58 KST: `growthhigh-recordings.timer` enabled/started, 작업 종료 후 5분마다 실행. 첫 service 실행 `Result=success`, `ExecMainStatus=0`, `0 differences found`, `1 matching files`. 새 보관본 0개/기존 기록 검증만 수행. CPU 사용 1.952초, 메모리 최고 116.5MiB. CPUQuota 25%, MemoryMax 768MiB 적용 확인. 기존 dashboard API/DB healthy, web/SFTP/gateway 컨테이너 계속 실행 중.
- 휴대폰 예약/일반 라벨 필터는 아직 켜지 않았다. 서버 전사·Notion 단계는 인증 미설정으로 명시적으로 건너뛴다. 새 녹음의 전체 자동 처리 성공을 의미하지 않는다.
- `run_vps_recordings.py`: 원본 보존 분류 → 고객 Drive 접수함으로 immutable copy → checksum check → 기존 `process_recordings.py`를 호출한다. Drive 전송/검증 실패 시 전사·게시를 실행하지 않는다. 내부 미팅은 Drive 전송 대상에서 제외한다.
- 고객 원본 이름이 같고 내용이 다르면 **서버 보관본**에만 `_2`, `_3` 등을 자동 부여한다. 재실행은 SHA256 장부의 같은 보관본을 사용하며 원본을 지우지 않는다. 휴대폰 저장·SFTP 수신 전에 같은 이름이 덮어써지는 경우까지 해결한 것은 아니다.
- 전사 전에 기존 Notion SHA256 기록의 고객·일자·소통형태를 확인하고 기존 기록이 있으면 Gemini 전사/요약을 생략한다. 기존 비공개 기록을 자동으로 공개하지 않는다.
- 위 변경 관련 로컬 검사 33개 통과. PC 전체 dry-run에서 신규 전사/요약/Notion/반영 대상 0개 확인. 이 PC의 GrowthHigh 녹음 예약 작업은 조회 결과 없음.
- VPS `/srv/growthhigh-recordings/pipeline/src`에 16개 실행 소스를 배포했고 전용 venv 설치 완료. 배포 묶음에는 인증·음성·전사문을 포함하지 않았고 해시로 검증했다. Drive의 이번 임시 배포 코드 파일은 전달 뒤 휴지통 처리했다.
- **인증 전달 승인 대기:** 자동 승인 검토가 기존 `GEMINI_API_KEY`, `NOTION_TOKEN`, `AUTOMATION_TOKEN`을 VPS로 전달하는 작업을 차단했다. 목적지와 세 인증값에 대한 명시적 승인이 없다는 이유다. 명령은 실행되지 않았고 인증값은 전송되지 않았다. `.env`가 없으면 서버 실행기는 Drive 전송까지만 수행한다.
- 승인 후 암호화 전달 가능: VPS `deploy/transfer-private.pem`은 이 전달만을 위한 RSA-4096 복호화 키(SSH 로그인 키 아님). 공개키로 세 인증값만 RSA-OAEP SHA256 암호화하고 비공개 임시 Drive 경로를 경유한다. 평문 출력/채팅/Git 저장 금지. 서버는 인증 파일을 mode 600으로 저장하며, 완료 후 임시 전달물/암호화 키를 정리한다.
- 운영 전 남은 확인: 새 녹음의 신규 전사→Notion→실제 고객 화면, 폰 임시 파일 업로드 및 일반 필터/예약 설정, 동일 이름 여러 통화의 폰 단계 보존, Google OAuth 장기 인증. 기존 Google OAuth 앱은 External/Testing이며 [공식 문서](https://developers.google.com/identity/protocols/oauth2)에 따라 이 범위의 refresh token은 7일 만료 대상이다. 현재 연결을 영구 무인 운영 준비 완료로 표현하지 않는다.

## 이전 단계 기록 (아래 시점별 상태는 위 최신 기록을 우선)

## 현재 우선순위 — 고객 통화·미팅

- 2026-10-08 위프코리아 전화 파일 `260827_위프코리아_통화.m4a` 수동 파일럿: Call → SFTP `/upload`, 938,103 bytes (916.1 KiB), 폰 전송 1개/제외 2,912개/삭제 0개. VPS 분류 1개 복사 후 기존 Drive 고객 폴더 `1Xh_QjqM8Jletd1NG6fep7khsDN_Vc-p_`에 copyto/check 성공(0 differences, 1 matching). 고객 접수함 ID `1VBAI2L_qBHLu1iJ5P4610AauGJAHUIXB`, 루트 ID `1EV3Ss6vvv5PUjcR9GtXXGWK36xeTE-I8` 확인.
- VPS/PC Drive SHA256 `ef3deef206e39c08c7abe8eca233f28f1b46e8f75f3b83806bb5b29ef738fe36` 일치. 신규 전사 후보 1개만 처리(469자). 기존 로컬 전사본을 덮어쓰지 않아 결과 파일만 자동 `_2.txt` 이름 사용; 사용자가 입력한 원본 이름은 그대로다.
- 동일 SHA256의 공개 Notion 기록 `3d9815d7-12b9-810d-bef1-fee2f98434d3`가 이미 존재했다. 고객/유형/일자/공개 및 지문 검증 후 장부를 기존 기록에 연결하고 complete 처리. 새 요약/Notion 생성/기존 본문 수정/재빌드 요청은 하지 않았다. 원격 최신 whiffkorea D1 고객 데이터에서 2026-08-27 통화 `K 수출 운영 사무국 발신 건 확인`을 확인. 이번 경로로 신규 생성부터 고객화면까지 검증한 것은 아니다.
- M4A mvhd 생성 시각 `2026-08-27T10:15:22Z` 읽기 확인(한국 시각 19:15:22). 실제 통화 시작인지/종료 시각인지 아직 미검증. 파일 수정 시각을 통화 시각으로 대신 쓰지 않는다.
- 휴대폰 필터/예약은 파일 한 개 수동 테스트 상태. VPS→Drive도 수동 전송이다. 상시 무인 자동화, 동일 이름 여러 원본 보존, 통화 시각 메타데이터의 운영 반영은 미완료.
- 시간 입력 제거 반영: 로컬 검사 30개 통과, VPS `app/recording_labels.py`와 로컬 LF 소스 SHA256 일치 및 서버 라벨 검사 통과. 서버에서 새 녹음 처리는 실행하지 않았다. 휴대폰 필터는 다음 테스트 파일명에 맞춰 변경해야 한다.
- 사용자 지시로 내부 미팅 전사/Notion 연결은 보류하고 고객페이지 자동화를 우선한다.
- 휴대폰 → VPS 전송과 내부 녹음 한 개의 VPS → Drive copy/check는 성공했다. 고객용 Drive 목적지 연결과 고객 녹음의 새 라벨 기반 전체 검증은 아직이다.
- 현재 PC의 고객 Drive 루트 및 단일 접수함 존재 확인(고객 폴더 17개). Gemini/Notion/고객페이지 재빌드 인증 설정은 존재하나 이번 회차의 실제 API 인증은 미검증.
- 기존 `process_recordings.py`는 전사 → 회의록 → Notion 공개 기록 → 고객페이지 갱신 요청을 연결한다. Drive Desktop과 로그인한 Windows PC에 의존하는 구조다. VPS 상시 처리로의 이전은 아직 하지 않았다.
- 첫 고객 테스트의 고객사/통화 또는 미팅/공개 가능한 녹음 선택을 사용자에게 요청했다. 선택 전 기존 고객 녹음 처리나 공개는 실행하지 않는다.
- 다음: 선택한 고객의 정확한 Drive 접수 폴더 확인 → 고객 파일 한 개 전송 → 전사/Notion/실제 고객페이지 검증 → 상시 실행 연결.

## 확정된 규칙

라벨링은 업로드와 고객 공개 의사표시다. 추가 공개 확인을 요구하지 않는다.
고객사/유형/날짜가 불명확하면 전사문으로 추측하지 않는다.

| 종류 | 파일명(확장자는 녹음 앱이 붙임) | 목적지 |
|---|---|---|
| 내부 오전 | `261008_내부_오전미팅.m4a` | 내부 회의록만 |
| 내부 마감 | `261008_내부_마감미팅.m4a` | 내부 회의록만 |
| 고객 통화 | `261008_위프코리아_통화.m4a` | 위프코리아 / 통화 |
| 고객 미팅 | `261008_위프코리아_미팅.m4a` | 위프코리아 / 미팅 |

날짜는 20YYMMDD. 사용자는 `YYMMDD_고객사_통화` 또는 `YYMMDD_고객사_미팅`까지만 입력한다. 시간이나 순번을 직접 붙이도록 요구하지 않는다. 기존 접미사가 있는 파일의 호환 처리는 유지한다.

실제 녹음 시각은 파일 내부 정보에서 확인할 예정이며 아직 추출/전송 후 보존 검증 전이다. 현재 장부의 `source_modified_at`은 수정 시각이므로 통화 시작 시각으로 단정하지 않는다. 전사 작업의 중복 여부는 이미 파일 SHA256으로 판별한다. 다만 같은 날짜/고객/유형의 서로 다른 파일을 같은 이름으로 받는 경우 VPS 분류기는 현재 덮어쓰지 않고 중단한다. 여러 건 운영 전 휴대폰 저장 및 SFTP 단계부터 원본을 보존하는 자동 구분을 검증해야 하며, 사용자에게 수동 번호 입력으로 해결하도록 요구하지 않는다.
고객사는 `client_mapping.py`와 `client_mapping.json`의 정확한 이름만 허용한다.
`미팅`은 대면/비대면을 추측하지 않는 별도 Notion 소통형태이며 고객 화면에는 미팅으로 표시한다.
같은 시각에 다른 파일을 저장해 이름이 충돌하면 덮어쓰지 않고 확인 대기한다.
기존 점 구분 날짜, 공백 구분 이름, 기본 통화녹음 이름은 자동 접수하지 않는다. 고객 라벨 뒤의 자동 ` (1)` 접미사는 허용하지만 내부 미팅에는 적용하지 않는다.

## 처리 경계

1. FolderSync: 파일명 포함 RegEx로 라벨된 m4a만 SFTP에 업로드한다.
2. VPS: `route_recordings.py`가 라벨/고객명을 재검사하고 원본을 보존하며 복사한다.
3. `ready/internal` → 내부 공유 Drive 폴더 → `meeting-automation/meeting.mjs` → 내부 Notion DB.
4. `ready/clients/수집대기/{고객사}` → 고객 공유 Drive의 같은 구조 → 기존 `process_recordings.py` → 고객 공개 Notion → 해당 고객 페이지.

VPS 분류기는 배포·실제 파일 검증 완료. VPS→Drive는 rclone 설치 후 Google 인증 대기다. `ready`의 숨김 장부 파일은 Drive에 전송하지 않는다.
VPS 분류기는 Python 3.11+ 표준 라이브러리만 사용한다. 함께 배포할 파일:
`route_recordings.py`, `recording_labels.py`, `client_mapping.py`, `client_mapping.json`.
출력 폴더는 root만 쓸 수 있게 유지하고 SFTP 사용자는 수신 폴더에만 쓴다.

```sh
# 기본은 읽기 전용 미리보기
python3 route_recordings.py --source /srv/growthhigh-recordings/inbox --output /srv/growthhigh-recordings/ready
# 미리보기 검증 뒤 한 회차 복사
python3 route_recordings.py --source /srv/growthhigh-recordings/inbox --output /srv/growthhigh-recordings/ready --apply
```

크기 0/512MiB 초과, 최근 2분 내 수정, `.partial` 파일은 대상에서 제외한다.
2분 경과만으로 전송 완료가 보장되지는 않는다. FolderSync 임시 파일 업로드 후 rename 설정을 확인한 뒤 운영한다.
원본/복사본 SHA256 비교, 이름 충돌 및 동일 음성의 다른 라벨 거부, 원자적 파일 공개,
중복 복사 방지, 오류 시 원본 보존을 검사했다. 큰 파일 검사는 합성 64MiB 파일이며 실제 폰 전송 증거가 아니다.

## 휴대폰 설정

갤럭시 기본 녹음 폴더: `/storage/emulated/0/Recordings/Voice Recorder`.
FolderSync: 휴대폰 → SFTP 단방향, 원본 삭제/삭제 동기화 끔, 임시 파일 사용 켬.
서버 `187.52.115.145`, 포트 `2222`, 사용자 `phone01`, 원격 `/upload`.
실제 호스트 키 지문을 VPS 콘솔과 비교한다. 비밀번호는 사용자가 직접 입력한다.
모바일 데이터 허용/배터리 제한 해제는 사용자 폰에서 확인해야 한다.

**첫 테스트는 `261008_내부_오전미팅.m4a` 정확히 한 파일만 포함.**
검증 전 전체 필터/주기 작업을 활성화하지 않는다.
정규식은 `python src/recording_labels.py`로 등록 고객 목록에서 생성한다.
FolderSync의 **포함 / 파일 이름 RegEx**에 넣으며 와일드카드 칸과 혼동하지 않는다.
월별 말일 검증은 서버가 수행한다. 고객 추가 시 휴대폰 필터도 갱신해야 한다.
PM별 계정 분리는 아직 미구현이며 phone01을 전 직원에게 공유하지 않는다.

## 변경 영향과 현재 상태

- 기존 `수집대기/{고객사}`의 무라벨 파일을 자동 통화 처리하던 동작을 중단했다.
- 이미 공개된 기록은 변경하지 않았다. 이전 무라벨 작업의 재게시도 라벨 검증에서 막힌다.
- 고객 게시 직전 원본 이름과 장부의 회사/slug/유형/날짜를 재검사한다.
- Python 관련 검사 50개 + 내부 처리 Node 검사 통과. 외부 API/실제 녹음/실서비스 배포는 미검증.
- 2026-10-08 phone01 비밀번호 설정 완료, `P` 상태 확인. 모든 파일 접근 권한 허용 후 5G에서 9.9MB 및 36.8MB 녹음 각 1개 전송 성공. 각 회 1,011개 제외/삭제 0개.
- 현재 휴대폰 포함 필터는 `261001_내부_오전미팅.m4a` 정확히 일치 한 개이며 예약은 꺼져 있다.
- VPS `app/`에 위 네 소스 배포 후 두 녹음을 `ready/internal/`로 복사했다. 첫 실행 2개/재실행 0개, inbox와 ready SHA256 일치. 휴대폰 원본 SHA256 대조는 미실시.
- 다음은 전용 Google OAuth 인증 및 내부 녹음 한 개의 Drive 전송이다. 자세한 현재 인증 대기 위치는 인접 `meeting-automation/HANDOFF.md`의 첫 절을 따른다.

## 검사

저장소 루트에서 `.venv/Scripts/python.exe -m unittest discover -s src/tests -p test_recording_labels.py`.
관련 회귀검사: `test_transcribe_drive`, `test_notion_talk_drafts`, `test_talk_source`,
`test_recording_jobs`, `test_summarize_recordings`, `test_run_recording_scheduler`.
Windows 샌드박스가 하드링크를 막으면 해당 복사 검사는 일반 권한 터미널에서 실행한다.
