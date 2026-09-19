import { snapshotSql } from "../src/private-store.js";

const literal = (value) => typeof value === "number"
  ? String(value)
  : `'${String(value).replaceAll("'", "''")}'`;

function chunks(value, limit = 60000) {
  const result = [];
  let part = "";
  let size = 0;
  for (const char of value) {
    const bytes = Buffer.byteLength(char, "utf8") + (char === "'" ? 1 : 0);
    if (size + bytes > limit && part) {
      result.push(part);
      part = "";
      size = 0;
    }
    part += char;
    size += bytes;
  }
  if (part || !result.length) result.push(part);
  return result;
}

export function snapshotScript(input) {
  snapshotSql(input); // 같은 검증을 먼저 통과한 값만 SQL로 바꾼다.
  const { slug, buildKey, startedAt, payload, assets = {} } = input;
  const savedAt = new Date().toISOString();
  const statements = [
    `INSERT INTO customer_snapshots (slug, build_key, source_started_at, payload, saved_at, ready) VALUES (${literal(slug)}, ${literal(buildKey)}, ${startedAt}, '{}', ${literal(savedAt)}, 0) ON CONFLICT (slug, build_key) DO NOTHING;`,
  ];
  chunks(JSON.stringify(payload)).forEach((part, index) => statements.push(
    `INSERT INTO customer_assets (slug, build_key, path, content_type, content_base64) SELECT ${literal(slug)}, ${literal(buildKey)}, ${literal(`__payload/${String(index).padStart(4, "0")}`)}, 'application/json-chunk', ${literal(part)} WHERE EXISTS (SELECT 1 FROM customer_snapshots WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)} AND ready = 0) ON CONFLICT (slug, build_key, path) DO NOTHING;`,
  ));
  for (const [path, asset] of Object.entries(assets)) {
    statements.push(`INSERT INTO customer_assets (slug, build_key, path, content_type, content_base64) SELECT ${literal(slug)}, ${literal(buildKey)}, ${literal(path)}, ${literal(asset.type)}, '' WHERE EXISTS (SELECT 1 FROM customer_snapshots WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)} AND ready = 0) ON CONFLICT (slug, build_key, path) DO NOTHING;`);
    for (const part of chunks(asset.data)) statements.push(
      `UPDATE customer_assets SET content_base64 = content_base64 || ${literal(part)} WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)} AND path = ${literal(path)} AND EXISTS (SELECT 1 FROM customer_snapshots WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)} AND ready = 0);`,
    );
  }
  statements.push(
    `UPDATE customer_snapshots SET payload = (SELECT group_concat(content_base64, '') FROM (SELECT content_base64 FROM customer_assets WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)} AND path LIKE '__payload/%' ORDER BY path)) WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)} AND ready = 0;`,
    `DELETE FROM customer_assets WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)} AND path LIKE '__payload/%';`,
    `UPDATE customer_snapshots SET ready = 1 WHERE slug = ${literal(slug)} AND build_key = ${literal(buildKey)};`,
    `DELETE FROM customer_snapshots WHERE slug = ${literal(slug)} AND ready = 1 AND id NOT IN (SELECT id FROM customer_snapshots WHERE slug = ${literal(slug)} AND ready = 1 ORDER BY source_started_at DESC, id DESC LIMIT 10);`,
  );
  return statements;
}
