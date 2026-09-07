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
 * 바깥에서 부르는 것은 넷뿐이다 — 최신 공지를 읽는다 · 주소로 읽는다 ·
 * 통째로 덮어쓴다, 그리고 앞으로 판 목록·되살리기(#38)가 여기 붙는다.
 * 창구 쪽 코드는 표도 열도 모른다. 테스트는 이 모듈을 가짜로 갈아 끼운다.
 *
 * 표는 둘이다.
 *
 * - `notices` — 기업(슬러그)·날짜·제목·문서·판 번호. 기업당 여러 건이 쌓이고,
 *   클라이언트 페이지에 오르는 것은 날짜가 가장 최근인 한 건이다.
 * - `revisions` — 저장할 때마다 쌓이는 지난 판. #38 이 채운다.
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

    /** 주소로 집는다. 어느 기업의 것인지는 부른 쪽이 슬러그로 확인한다. */
    async byId(id) {
      const row = await db.prepare("SELECT * FROM notices WHERE id = ?").bind(id).first();
      return toNotice(row);
    },

    /**
     * 문서를 통째로 덮어쓰고 판 번호를 하나 올린다.
     *
     * **판 번호가 그대로일 때만 쓴다.** 읽어 보고 나서 쓰면 그 사이에 다른
     * 담당자가 저장한 것을 조용히 덮어쓴다. 어긋났으면 null 을 돌려주고
     * 아무것도 쓰지 않는다.
     */
    async replace({ id, expect, title, sections }) {
      const at = new Date().toISOString();
      const row = await db.prepare(
        `UPDATE notices SET title = ?, doc = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ? RETURNING *`,
      ).bind(title, JSON.stringify({ sections }), at, id, expect).first();
      return toNotice(row);
    },
  };
}

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
    sections: readDoc(row.doc),
  };
}

/**
 * 저장해 둔 문서를 편다.
 *
 * **깨져 있으면 빈 문서로 봐주지 않고 던진다.** 빈 문서로 열어 주면 담당자는
 * 아무것도 없는 화면을 보고 그 위에 저장하는데, 판 번호는 멀쩡하므로 저장이
 * 그대로 통과해 **진짜 내용이 영영 사라진다** — 되돌릴 판도 아직 없다(#38).
 * 여기 오는 것은 우리가 쓴 적 없는 모양이라, 조용히 넘기지 않고 500 으로
 * 드러내는 편이 낫다.
 */
function readDoc(raw) {
  const doc = JSON.parse(raw);
  if (!Array.isArray(doc?.sections)) throw new Error("공지 문서의 모양이 아닙니다");
  return doc.sections;
}
