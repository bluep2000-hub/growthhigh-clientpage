-- 위프코리아 한 곳만 허용하던 파일럿 제약을 안전한 슬러그 형식으로 넓힌다.
PRAGMA foreign_keys = OFF;

CREATE TABLE customer_snapshots_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 63 AND slug NOT GLOB '*[^a-z0-9-]*' AND substr(slug, 1, 1) GLOB '[a-z0-9]'),
    build_key TEXT NOT NULL CHECK (length(build_key) BETWEEN 1 AND 128),
    source_started_at INTEGER NOT NULL CHECK (source_started_at > 0),
    payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
    saved_at TEXT NOT NULL,
    ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1)),
    UNIQUE (slug, build_key)
);
INSERT INTO customer_snapshots_next SELECT id, slug, build_key, source_started_at, payload, saved_at, ready FROM customer_snapshots;

CREATE TABLE customer_credentials_next (
    slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 1 AND 63 AND slug NOT GLOB '*[^a-z0-9-]*' AND substr(slug, 1, 1) GLOB '[a-z0-9]'),
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL CHECK (iterations = 100000),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO customer_credentials_next SELECT * FROM customer_credentials;

CREATE TABLE customer_sessions_next (
    token_hash TEXT PRIMARY KEY,
    slug TEXT NOT NULL REFERENCES customer_credentials_next(slug) ON DELETE CASCADE,
    credential_version INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
INSERT INTO customer_sessions_next SELECT * FROM customer_sessions;

CREATE TABLE customer_assets_next (
    slug TEXT NOT NULL,
    build_key TEXT NOT NULL,
    path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content_base64 TEXT NOT NULL,
    PRIMARY KEY (slug, build_key, path),
    FOREIGN KEY (slug, build_key) REFERENCES customer_snapshots_next(slug, build_key) ON DELETE CASCADE
);
INSERT INTO customer_assets_next SELECT * FROM customer_assets;

CREATE TABLE private_rebuild_job_next (
    slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 1 AND 63 AND slug NOT GLOB '*[^a-z0-9-]*' AND substr(slug, 1, 1) GLOB '[a-z0-9]'),
    requested_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('requested', 'running', 'completed', 'failed')),
    lease_owner TEXT,
    lease_until INTEGER,
    completed_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
INSERT INTO private_rebuild_job_next SELECT * FROM private_rebuild_job;

DROP TABLE customer_assets;
DROP TABLE customer_sessions;
DROP TABLE private_rebuild_job;
DROP TABLE customer_snapshots;
DROP TABLE customer_credentials;

ALTER TABLE customer_snapshots_next RENAME TO customer_snapshots;
ALTER TABLE customer_credentials_next RENAME TO customer_credentials;
ALTER TABLE customer_sessions_next RENAME TO customer_sessions;
ALTER TABLE customer_assets_next RENAME TO customer_assets;
ALTER TABLE private_rebuild_job_next RENAME TO private_rebuild_job;
CREATE INDEX customer_snapshots_latest ON customer_snapshots (slug, source_started_at DESC, id DESC);

PRAGMA foreign_keys = ON;
