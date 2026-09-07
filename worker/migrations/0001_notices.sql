-- 공지 저장소. 공지의 원본이 노션에서 여기로 옮겨 온다.
-- 결정의 이유는 ../../docs/adr/0004-공지-원본-이사.md 를 본다.
--
--   npx wrangler d1 migrations apply growthhigh-clientpage-notices --remote
--   npx wrangler d1 migrations apply growthhigh-clientpage-notices --local

-- 공지 한 건. 기업(슬러그)당 여러 건이 쌓이고, 클라이언트 페이지에 오르는
-- 것은 날짜가 가장 최근인 한 건이다.
CREATE TABLE IF NOT EXISTS notices (
  -- 중계 서버가 만든 짧은 이름. 노션 페이지 UUID 가 아니다.
  id         TEXT    PRIMARY KEY,
  slug       TEXT    NOT NULL,
  "date"     TEXT    NOT NULL,
  title      TEXT    NOT NULL DEFAULT '',
  -- 공지 문서. 섹션과 항목이 든 JSON 한 덩어리다. 항목을 행으로 흩어 놓지
  -- 않는 것은 저장이 문서를 통째로 덮어쓰기 때문이다 — 순서와 중첩이
  -- 배열을 바꾸는 일이 되어야 하위 항목이 몇 개든 상관없어진다.
  doc        TEXT    NOT NULL DEFAULT '{"sections":[]}',
  -- 판 번호. 저장할 때마다 하나 오른다. 편집 모드가 연 뒤 이 값이 올랐으면
  -- 저장이 거절된다.
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT    NOT NULL
);

-- 「그 기업의 가장 최근 공지」가 이 표를 두드리는 거의 모든 길이다.
CREATE INDEX IF NOT EXISTS notices_by_slug ON notices (slug, "date" DESC);

-- 지난 판. 저장이 성공할 때마다 직전 문서가 여기 쌓이고, 공지 하나당 최근
-- 20판만 남는다.
CREATE TABLE IF NOT EXISTS revisions (
  notice_id TEXT    NOT NULL REFERENCES notices (id) ON DELETE CASCADE,
  version   INTEGER NOT NULL,
  title     TEXT    NOT NULL DEFAULT '',
  doc       TEXT    NOT NULL,
  saved_at  TEXT    NOT NULL,
  PRIMARY KEY (notice_id, version)
);
