CREATE TABLE recommendation_items (
    customer_slug TEXT NOT NULL REFERENCES customer_credentials(slug) ON DELETE CASCADE,
    program_slug TEXT NOT NULL CHECK (length(program_slug) BETWEEN 1 AND 180),
    added_at TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (customer_slug, program_slug)
);
CREATE INDEX recommendation_items_order ON recommendation_items (customer_slug, created_at, program_slug);
