import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { snapshotScript } from "../scripts/private-snapshot-sql.mjs";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

function payload() {
  return {
    generated_at: "2026-09-19T12:00:00+09:00",
    company: { name: `가상 기업 '${"긴본문".repeat(40000)}` },
    notice: null, perf: null, progress: [], recommend: [], talks: [],
    actions: [], actions_done: 0, events: [], kpi: {},
  };
}

test("큰 비공개 결과도 D1 한 문장 제한을 넘지 않고 원문 그대로 저장한다", () => {
  const input = {
    slug: "whiffkorea", buildKey: "large-fixture", startedAt: 1,
    payload: payload(),
    assets: { "logo/whiffkorea.png": { type: "image/png", data: "QUJD".repeat(50000) } },
  };
  const statements = snapshotScript(input);
  expect(statements.every((sql) => Buffer.byteLength(sql, "utf8") < 100000)).toBe(true);

  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`CREATE TABLE customer_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL CHECK (slug = 'whiffkorea'),
      build_key TEXT NOT NULL, source_started_at INTEGER NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
      saved_at TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1)),
      UNIQUE(slug, build_key));
      CREATE TABLE customer_assets (
      slug TEXT NOT NULL CHECK (slug = 'whiffkorea'), build_key TEXT NOT NULL,
      path TEXT NOT NULL, content_type TEXT NOT NULL, content_base64 TEXT NOT NULL,
      PRIMARY KEY (slug, build_key, path),
      FOREIGN KEY (slug, build_key) REFERENCES customer_snapshots(slug, build_key) ON DELETE CASCADE);`);
    sqlite.exec(`BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
    const row = sqlite.prepare("SELECT payload, ready FROM customer_snapshots WHERE build_key = ?").get(input.buildKey);
    const asset = sqlite.prepare("SELECT content_base64 FROM customer_assets WHERE build_key = ?").get(input.buildKey);
    expect(row.ready).toBe(1);
    expect(JSON.parse(row.payload)).toEqual(input.payload);
    expect(asset.content_base64).toBe(input.assets["logo/whiffkorea.png"].data);
  } finally {
    sqlite.close();
  }
});
