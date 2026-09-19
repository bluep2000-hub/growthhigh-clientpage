-- 수집 도중의 결과는 조회하지 않는다. 이미지와 본문을 연결한 뒤에만 ready=1로 만든다.
ALTER TABLE customer_snapshots ADD COLUMN ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1));
CREATE TABLE customer_assets (
    slug TEXT NOT NULL CHECK (slug = 'whiffkorea'),
    build_key TEXT NOT NULL,
    path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content_base64 TEXT NOT NULL,
    PRIMARY KEY (slug, build_key, path),
    FOREIGN KEY (slug, build_key) REFERENCES customer_snapshots(slug, build_key) ON DELETE CASCADE
);
