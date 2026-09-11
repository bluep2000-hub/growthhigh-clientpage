-- 담당자가 쓰는 초안과 고객에게 보이는 게시본을 분리한다.
--
-- 기존 notices 행은 이미 고객 화면에 나가던 게시본이므로 updated_at 을 최초
-- 게시 시각으로 삼는다. 이후 새 공지는 published_at 이 NULL 인 자리만 먼저
-- 만들고, 담당자가 「게시」를 눌렀을 때 비로소 값이 들어간다.

ALTER TABLE notices ADD COLUMN published_at TEXT;

UPDATE notices
   SET published_at = updated_at
 WHERE published_at IS NULL;

-- 공지 하나당 편집 중인 초안은 하나다. 자동저장은 이 표만 바꾸므로 게시본의
-- 판 번호와 지난 버전 20개를 밀어내지 않는다.
CREATE TABLE IF NOT EXISTS notice_drafts (
  notice_id              TEXT    PRIMARY KEY REFERENCES notices (id) ON DELETE CASCADE,
  title                  TEXT    NOT NULL DEFAULT '',
  doc                    TEXT    NOT NULL DEFAULT '{"sections":[]}',
  version                INTEGER NOT NULL DEFAULT 1,
  base_published_version INTEGER NOT NULL,
  updated_at             TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS notice_drafts_updated
  ON notice_drafts (updated_at DESC);
