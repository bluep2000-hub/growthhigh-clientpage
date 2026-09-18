CREATE TABLE customer_credentials (
    slug TEXT PRIMARY KEY CHECK (slug = 'whiffkorea'),
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL CHECK (iterations = 100000),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE customer_sessions (
    token_hash TEXT PRIMARY KEY,
    slug TEXT NOT NULL REFERENCES customer_credentials(slug) ON DELETE CASCADE,
    credential_version INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE staff_sessions (
    token_hash TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    provider_expires_at INTEGER NOT NULL
);
CREATE TABLE staff_login_nonces (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
-- 입력 실패 횟수로 기업 계정을 잠그지 않는다. 요청량만 IP별로 잠시 제한한다.
-- IP 원문은 저장하지 않는다.
CREATE TABLE auth_request_buckets (
    bucket_key TEXT PRIMARY KEY,
    window INTEGER NOT NULL,
    count INTEGER NOT NULL
);
