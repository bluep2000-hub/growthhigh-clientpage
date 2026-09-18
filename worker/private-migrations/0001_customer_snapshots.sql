-- 기존 공지 DB와 분리된 고객 공개용 정상 결과 저장소.
-- 완성된 결과만 한 번에 저장한다. 실패한 수집 결과는 저장하지 않는다.
-- 위프코리아 파일럿 외 기업은 DB에서도 차단한다.
CREATE TABLE customer_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL CHECK (slug = 'whiffkorea'),
    build_key TEXT NOT NULL CHECK (length(build_key) BETWEEN 1 AND 128),
    source_started_at INTEGER NOT NULL CHECK (source_started_at > 0),
    payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
    saved_at TEXT NOT NULL,
    UNIQUE (slug, build_key)
);

CREATE INDEX customer_snapshots_latest
    ON customer_snapshots (slug, source_started_at DESC, id DESC);
