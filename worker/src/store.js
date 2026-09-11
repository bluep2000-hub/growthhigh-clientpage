/**
 * 공지 저장소. **SQL 은 이 파일에만 있다.**
 *
 * 공지의 원본이 노션에서 여기로 옮겨 온다(`docs/adr/0004-공지-원본-이사.md`).
 * 저장소가 D1 인 것은 쓰고 나서 바로 읽으면 반드시 방금 쓴 것이 나오기
 * 때문이다 — KV 는 전파에 최대 60초가 걸려 「저장 → 재빌드」 사이에 옛 공지가
 * 나갈 수 있다.
 *
 * **테스트는 이 파일을 가짜로 갈아 끼운다**(`test/fake-store.js`). SQL 자체는
 * 로컬 D1 에 걸어 눈으로 확인한다 — 표를 세우고(`wrangler d1 migrations apply
 * growthhigh-clientpage-notices --local`) 아래 문장을 그대로 넣어 보면 된다
 * (`wrangler d1 execute … --local --command "…"`).
 *
 * 바깥에서 부르는 것은 여섯뿐이다 — 최신 공지를 읽는다 · 그 날짜 것을 읽는다 ·
 * 주소로 읽는다 · 만든다 · 통째로 덮어쓴다 · 판을 읽는다. 창구 쪽 코드는 표도
 * 열도 모른다. 테스트는 이 모듈을 가짜로 갈아 끼운다.
 *
 * 표는 셋이다.
 *
 * - `notices` — 기업(슬러그)·날짜·제목·문서·판 번호. 기업당 여러 건이 쌓이고,
 *   클라이언트 페이지에 오르는 것은 날짜가 가장 최근인 한 건이다.
 * - `revisions` — 저장할 때마다 쌓이는 지난 판. 공지 하나당 최근 스무 판.
 * - `notice_drafts` — 담당자가 편집 중인 초안. 자동저장은 여기만 바꾸고,
 *   게시할 때만 `notices` 로 승격한다.
 */

/**
 * @param {{ DB?: D1Database }} env
 * @returns {object|null} 저장소. D1 이 붙어 있지 않으면 null 이다.
 */
export function createStore(env) {
  const db = env?.DB;
  if (!db) return null;

  return {
    /** 그 기업의 공지 중 날짜가 가장 최근인 한 건. 없으면 null. */
    async latest(slug) {
      const row = await db.prepare(
        `SELECT * FROM notices WHERE slug = ? ORDER BY "date" DESC, id DESC LIMIT 1`,
      ).bind(slug).first();
      return toNotice(row);
    },

    /** 고객 화면과 빌드가 읽는 가장 최근 게시본. 빈 새 초안은 여기서 빠진다. */
    async latestPublished(slug) {
      const row = await db.prepare(
        `SELECT * FROM notices WHERE slug = ? AND published_at IS NOT NULL
          ORDER BY "date" DESC, id DESC LIMIT 1`,
      ).bind(slug).first();
      return toNotice(row);
    },

    /** 그 기업의 그 날짜 공지. 하루에 한 건뿐이라 있으면 하나다. */
    async onDate(slug, date) {
      const row = await db.prepare(
        `SELECT * FROM notices WHERE slug = ? AND "date" = ?`,
      ).bind(slug, date).first();
      return toNotice(row);
    },

    /**
     * 빈 공지 한 건을 만든다.
     *
     * 이미 그 날짜 공지가 있으면 **만들지 않고 null 을 돌려준다.** 표의
     * 짝짓기가 막아 주므로, 담당자 둘이 같은 순간에 눌러도 둘이 되지 않는다.
     */
    async create({ id, slug, date }) {
      const at = new Date().toISOString();
      const row = await db.prepare(
        `INSERT INTO notices
              (id, slug, "date", title, doc, version, updated_at, published_at)
              VALUES (?, ?, ?, '', '{"sections":[]}', 1, ?, NULL)
         ON CONFLICT (slug, "date") DO NOTHING RETURNING *`,
      ).bind(id, slug, date, at).first();
      return toNotice(row);
    },

    /** 주소로 집는다. 어느 기업의 것인지는 부른 쪽이 슬러그로 확인한다. */
    async byId(id) {
      const row = await db.prepare("SELECT * FROM notices WHERE id = ?").bind(id).first();
      return toNotice(row);
    },

    /** 초안이 없으면 지금 게시본을 복사해 첫 초안을 만든다. */
    async ensureDraft(id) {
      const at = new Date().toISOString();
      await db.prepare(
        `INSERT INTO notice_drafts
              (notice_id, title, doc, version, base_published_version, updated_at)
         SELECT id, title, doc, 1, version, ? FROM notices WHERE id = ?
         ON CONFLICT (notice_id) DO NOTHING`,
      ).bind(at, id).run();
      const row = await db.prepare(
        "SELECT * FROM notice_drafts WHERE notice_id = ?",
      ).bind(id).first();
      return toDraft(row);
    },

    /** 주소로 초안을 읽는다. */
    async draft(id) {
      const row = await db.prepare(
        "SELECT * FROM notice_drafts WHERE notice_id = ?",
      ).bind(id).first();
      return toDraft(row);
    },

    /** 게시본은 건드리지 않고 초안만 통째로 자동저장한다. */
    async replaceDraft({ id, expect, title, sections }) {
      const at = new Date().toISOString();
      const row = await db.prepare(
        `UPDATE notice_drafts
            SET title = ?, doc = ?, version = version + 1, updated_at = ?
          WHERE notice_id = ? AND version = ? RETURNING *`,
      ).bind(title, JSON.stringify({ sections }), at, id, expect).first();
      return toDraft(row);
    },

    /**
     * 초안을 게시본으로 승격한다.
     *
     * 초안 판과 그 초안이 출발한 게시 판이 둘 다 그대로일 때만 쓴다. 게시된
     * 적이 있는 문서는 직전 게시본을 revisions 에 남기고, 새 공지는 빈 자리를
     * 판으로 남기지 않는다. D1 batch 는 한 트랜잭션이라 중간 상태가 없다.
     */
    async publishDraft({ id, draftExpect, publishedExpect }) {
      const at = new Date().toISOString();
      const [, updated] = await db.batch([
        db.prepare(
          `INSERT OR IGNORE INTO revisions (notice_id, version, title, doc, saved_at)
           SELECT n.id, n.version, n.title, n.doc, n.updated_at
             FROM notices n JOIN notice_drafts d ON d.notice_id = n.id
            WHERE n.id = ? AND n.version = ? AND n.published_at IS NOT NULL
              AND d.version = ? AND d.base_published_version = ?`,
        ).bind(id, publishedExpect, draftExpect, publishedExpect),
        db.prepare(
          `UPDATE notices
              SET title = (SELECT title FROM notice_drafts WHERE notice_id = ?),
                  doc = (SELECT doc FROM notice_drafts WHERE notice_id = ?),
                  version = version + 1, updated_at = ?, published_at = ?
            WHERE id = ? AND version = ? AND EXISTS (
              SELECT 1 FROM notice_drafts
               WHERE notice_id = ? AND version = ? AND base_published_version = ?)
            RETURNING *`,
        ).bind(id, id, at, at, id, publishedExpect,
               id, draftExpect, publishedExpect),
        db.prepare(
          `UPDATE notice_drafts SET base_published_version = ?, updated_at = ?
            WHERE notice_id = ? AND version = ? AND EXISTS (
              SELECT 1 FROM notices
               WHERE id = ? AND version = ? AND published_at = ?)`,
        ).bind(publishedExpect + 1, at, id, draftExpect,
               id, publishedExpect + 1, at),
        db.prepare(
          `DELETE FROM revisions WHERE notice_id = ? AND version < (
             SELECT MIN(version) FROM (SELECT version FROM revisions
               WHERE notice_id = ? ORDER BY version DESC LIMIT ?))`,
        ).bind(id, id, KEEP),
      ]);
      return toNotice((updated?.results || [])[0]);
    },

    /**
     * 문서를 통째로 덮어쓰고 판 번호를 하나 올린다.
     *
     * **판 번호가 그대로일 때만 쓴다.** 읽어 보고 나서 쓰면 그 사이에 다른
     * 담당자가 저장한 것을 조용히 덮어쓴다. 어긋났으면 null 을 돌려주고
     * 아무것도 쓰지 않는다.
     *
     * 쓰기 직전에 **지금 문서를 판으로 남긴다.** 남기는 것이 방금 저장한 것이
     * 아니라 직전 것인 까닭은, 되돌린다는 말이 「저장하기 전으로」이기
     * 때문이다. 셋을 한 묶음으로 보내 어느 하나만 들어가는 일이 없게 한다.
     */
    async replace({ id, expect, title, sections }) {
      const at = new Date().toISOString();
      const [, updated] = await db.batch([
        // 판 번호가 어긋나면 여기서도 한 줄도 담기지 않는다 — 아래 UPDATE 와
        // 같은 조건이라, 거절된 저장이 판만 남기는 일이 없다.
        db.prepare(
          `INSERT OR IGNORE INTO revisions (notice_id, version, title, doc, saved_at)
                SELECT id, version, title, doc, updated_at
                  FROM notices WHERE id = ? AND version = ?`,
        ).bind(id, expect),
        db.prepare(
          `UPDATE notices SET title = ?, doc = ?, version = version + 1,
                              updated_at = ?, published_at = ?
            WHERE id = ? AND version = ? RETURNING *`,
        ).bind(title, JSON.stringify({ sections }), at, at, id, expect),
        // 최근 KEEP 판만 남긴다. 그보다 오래된 것은 되돌릴 목록에도 뜨지 않아
        // 이고 있어 봐야 저장소만 불어난다.
        db.prepare(
          `DELETE FROM revisions WHERE notice_id = ? AND version < (
             SELECT MIN(version) FROM (SELECT version FROM revisions
               WHERE notice_id = ? ORDER BY version DESC LIMIT ?))`,
        ).bind(id, id, KEEP),
      ]);
      return toNotice((updated?.results || [])[0]);
    },

    /** 되돌릴 수 있는 판 목록. 최근 것이 앞이다. 문서는 싣지 않는다. */
    async revisions(id) {
      const res = await db.prepare(
        `SELECT version, title, saved_at FROM revisions
          WHERE notice_id = ? ORDER BY version DESC LIMIT ?`,
      ).bind(id, KEEP).all();
      return (res.results || []).map(
        (r) => ({ version: r.version, title: r.title ?? "", savedAt: r.saved_at }));
    },

    /** 그 판의 문서. 없으면 null. */
    async revision(id, version) {
      const row = await db.prepare(
        "SELECT title, doc FROM revisions WHERE notice_id = ? AND version = ?",
      ).bind(id, version).first();
      if (!row) return null;
      return { title: row.title ?? "", sections: readDoc(row.doc) };
    },
  };
}

/** 공지 하나가 이고 가는 판의 수. ADR 0004 가 정한 스무 판이다. */
const KEEP = 20;

/** 한 줄 → 공지 한 건. 문서는 열이 아니라 JSON 한 덩어리로 들어 있다. */
function toNotice(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    date: row.date,
    title: row.title ?? "",
    version: row.version,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? null,
    sections: readDoc(row.doc),
  };
}

/** 초안 한 줄. 게시본과 이름이 겹치지 않는 판 정보만 따로 붙인다. */
function toDraft(row) {
  if (!row) return null;
  return {
    noticeId: row.notice_id,
    title: row.title ?? "",
    version: row.version,
    basePublishedVersion: row.base_published_version,
    updatedAt: row.updated_at,
    sections: readDoc(row.doc),
  };
}

/**
 * 저장해 둔 문서를 편다.
 *
 * **깨져 있으면 빈 문서로 봐주지 않고 던진다.** 빈 문서로 열어 주면 담당자는
 * 아무것도 없는 화면을 보고 그 위에 저장하는데, 판 번호는 멀쩡하므로 저장이
 * 그대로 통과해 **진짜 내용이 영영 사라진다.** 여기 오는 것은 우리가 쓴 적
 * 없는 모양이라, 조용히 넘기지 않고 500 으로 드러내는 편이 낫다.
 */
function readDoc(raw) {
  const doc = JSON.parse(raw);
  if (!Array.isArray(doc?.sections)) throw new Error("공지 문서의 모양이 아닙니다");
  return doc.sections;
}
