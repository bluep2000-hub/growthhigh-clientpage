CREATE TABLE private_rebuild_job (
    slug TEXT PRIMARY KEY CHECK (slug = 'whiffkorea'),
    requested_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('requested', 'running', 'completed', 'failed')),
    lease_owner TEXT,
    lease_until INTEGER,
    completed_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
