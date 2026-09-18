/**
 * 서버 내부 저장용. 고객 인증과 HTTP 응답은 여기서 다루지 않는다.
 * 고객 공개용으로 변환한 완성된 결과만 전달한다. Notion 원본 객체는 넣지 않는다.
 */
const SLUG = "whiffkorea";
const PAYLOAD_KEYS = [
  "generated_at", "company", "notice", "perf", "progress", "recommend", "talks",
  "actions", "actions_done", "events", "kpi",
];
const COMPANY_KEYS = [
  "name", "biz", "tags", "manager", "logo", "logo_emoji", "address", "founded",
  "industry", "certs", "drive_url", "bizplan_url", "guidebook_url", "extra_links", "pinned_links",
];

function requireSlug(slug) {
  if (slug !== SLUG) throw new Error("unsupported_client");
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializePayload(payload) {
  if (!object(payload) || Object.keys(payload).some((key) => !PAYLOAD_KEYS.includes(key))
      || PAYLOAD_KEYS.some((key) => !Object.hasOwn(payload, key))
      || !object(payload.company) || typeof payload.company.name !== "string"
      || Object.keys(payload.company).some((key) => !COMPANY_KEYS.includes(key))
      || !["progress", "recommend", "talks", "actions", "events"].every((key) => Array.isArray(payload[key]))
      || !Number.isSafeInteger(payload.actions_done) || payload.actions_done < 0
      || !object(payload.kpi) || !Number.isFinite(Date.parse(payload.generated_at))) {
    throw new Error("invalid_customer_payload");
  }
  const text = JSON.stringify(payload);
  // D1 행 상한보다 작게 막는다. 초과하면 기존 정상 결과를 유지한다.
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error("payload_too_large");
  return text;
}

/** PRIVATE_DB가 없으면 멈춘다. 기존 공지 DB로 대체하지 않는다. */
export function createPrivateStore(env) {
  const db = env?.PRIVATE_DB;
  if (!db) throw new Error("private_database_unavailable");

  return {
    /** 내부 서버 전용. HTTP 호출부에서 먼저 기업 세션을 검증해야 한다. */
    async latest(slug) {
      requireSlug(slug);
      const row = await db.prepare(
        `SELECT build_key, source_started_at, payload, saved_at FROM customer_snapshots
         WHERE slug = ? ORDER BY source_started_at DESC, id DESC LIMIT 1`,
      ).bind(slug).first();
      return row ? {
        buildKey: row.build_key, startedAt: row.source_started_at,
        payload: JSON.parse(row.payload), savedAt: row.saved_at,
      } : null;
    },

    /** 중복 키는 덮어쓰지 않는다. 늦게 끝난 과거 수집으로 최신 결과를 되돌리지 않는다. */
    async save({ slug, buildKey, startedAt, payload }) {
      requireSlug(slug);
      if (typeof buildKey !== "string" || !buildKey.trim() || buildKey.length > 128
          || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
        throw new Error("invalid_snapshot_request");
      }
      const text = serializePayload(payload);
      // D1 batch는 원자적이다. 이력 정리에 실패해도 새 결과만 부분 저장되지 않는다.
      await db.batch([
        db.prepare(`INSERT INTO customer_snapshots
          (slug, build_key, source_started_at, payload, saved_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (slug, build_key) DO NOTHING`)
          .bind(slug, buildKey, startedAt, text, new Date().toISOString()),
        db.prepare(`DELETE FROM customer_snapshots WHERE slug = ? AND id NOT IN (
          SELECT id FROM customer_snapshots WHERE slug = ?
          ORDER BY source_started_at DESC, id DESC LIMIT 10)`).bind(slug, slug),
      ]);
      return this.latest(slug);
    },
  };
}
