/**
 * 가짜 공지 저장소. D1 에 붙지 않는다.
 *
 * `src/store.js` 를 이것으로 갈아 끼우고, 테스트는 창구에 요청을 넣어
 * 두 가지만 본다 — 무엇이 돌아왔나, 저장소에 무엇이 남았나. SQL 은 진짜
 * 저장소 한 곳에만 있으므로 여기서는 창구 넷의 뜻만 흉내 낸다.
 */

/** id → 공지 한 건. 진짜 저장소의 `공지` 표 자리다. */
const notices = new Map();

/** 공지 주소 → 판 배열. 진짜 저장소의 `판` 표 자리다. */
const revisions = new Map();

/** 공지 주소 → 편집 중인 초안. */
const drafts = new Map();

/** 공지 하나가 이고 가는 판의 수. 진짜 저장소의 KEEP 과 같아야 한다. */
const KEEP = 20;

let saved = 0;

export function reset() {
  notices.clear();
  revisions.clear();
  drafts.clear();
  saved = 0;
}

/** 저장소에 공지 한 건을 미리 놓는다. */
export function seed(row) {
  const full = {
    version: 1, title: "", sections: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    publishedAt: "2026-09-01T00:00:00.000Z", ...row,
  };
  notices.set(full.id, full);
  return full;
}

/** 지금 저장소에 있는 그 공지. 「무엇이 남았나」를 볼 때 쓴다. */
export const stored = (id) => notices.get(id);

export const storedDraft = (id) => drafts.get(id);

export const all = () => [...notices.values()];

export function createStore(env) {
  // 진짜 저장소와 같다 — D1 이 붙어 있지 않으면 열리지 않는다.
  if (!env?.DB) return null;
  return {
    /** 그 기업의 공지 중 날짜가 가장 최근인 한 건.
        날짜가 같으면 주소로 가른다 — 진짜 저장소의 `ORDER BY "date" DESC, id DESC` 와
        같아야 한다. 어긋나면 창구는 통과하는데 배포본만 다른 공지를 연다. */
    async latest(slug) {
      const key = (n) => `${n.date}\u0000${n.id}`;
      const mine = [...notices.values()].filter((n) => n.slug === slug);
      mine.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
      return mine[0] ?? null;
    },

    async latestPublished(slug) {
      const key = (n) => `${n.date}\u0000${n.id}`;
      const mine = [...notices.values()]
        .filter((n) => n.slug === slug && n.publishedAt !== null);
      mine.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
      return mine[0] ?? null;
    },

    /** 그 기업의 그 날짜 공지. 하루에 한 건뿐이라 있으면 하나다. */
    async onDate(slug, date) {
      return [...notices.values()].find((n) => n.slug === slug && n.date === date) ?? null;
    },

    /** 빈 공지 한 건. 그 날짜 공지가 이미 있으면 만들지 않고 null 이다 —
        진짜 저장소에서는 표의 짝짓기가 그것을 막는다. */
    async create({ id, slug, date }) {
      if ([...notices.values()].some((n) => n.slug === slug && n.date === date)) return null;
      return seed({ id, slug, date, title: "", sections: [], version: 1,
                    publishedAt: null });
    },

    async byId(id) {
      return notices.get(id) ?? null;
    },

    async ensureDraft(id) {
      if (!drafts.has(id)) {
        const row = notices.get(id);
        if (!row) return null;
        drafts.set(id, {
          noticeId: id, title: row.title, sections: structuredClone(row.sections),
          version: 1, basePublishedVersion: row.version,
          updatedAt: row.updatedAt,
        });
      }
      return drafts.get(id);
    },

    async draft(id) {
      return drafts.get(id) ?? null;
    },

    async replaceDraft({ id, expect, title, sections }) {
      const row = drafts.get(id);
      if (!row || row.version !== expect) return null;
      saved += 1;
      const next = {
        ...row, title, sections: structuredClone(sections), version: row.version + 1,
        updatedAt: new Date(Date.parse(row.updatedAt) + saved * 60000).toISOString(),
      };
      drafts.set(id, next);
      return next;
    },

    async publishDraft({ id, draftExpect, publishedExpect }) {
      const pub = notices.get(id);
      const draft = drafts.get(id);
      if (!pub || !draft || pub.version !== publishedExpect
          || draft.version !== draftExpect
          || draft.basePublishedVersion !== publishedExpect) return null;
      saved += 1;
      if (pub.publishedAt !== null) {
        const kept = revisions.get(id) || [];
        kept.push({ version: pub.version, title: pub.title,
                    sections: structuredClone(pub.sections), savedAt: pub.updatedAt });
        revisions.set(id, kept.slice(-KEEP));
      }
      const at = new Date(Date.parse(pub.updatedAt) + saved * 60000).toISOString();
      const next = {
        ...pub, title: draft.title, sections: structuredClone(draft.sections),
        version: pub.version + 1, updatedAt: at, publishedAt: at,
      };
      notices.set(id, next);
      drafts.set(id, { ...draft, basePublishedVersion: next.version, updatedAt: at });
      return next;
    },

    /** 판 번호가 그대로일 때만 덮어쓴다. 어긋났으면 null 이다.
        쓰기 직전의 문서를 판으로 남기고 최근 KEEP 판만 이고 간다 —
        진짜 저장소가 한 묶음으로 하는 일과 같다. */
    async replace({ id, expect, title, sections }) {
      const row = notices.get(id);
      if (!row || row.version !== expect) return null;
      saved += 1;
      const kept = revisions.get(id) || [];
      kept.push({ version: row.version, title: row.title,
                  sections: row.sections, savedAt: row.updatedAt });
      revisions.set(id, kept.slice(-KEEP));
      const next = {
        ...row, title, sections,
        version: row.version + 1,
        updatedAt: new Date(Date.parse(row.updatedAt) + saved * 60000).toISOString(),
        publishedAt: new Date(Date.parse(row.updatedAt) + saved * 60000).toISOString(),
      };
      notices.set(id, next);
      return next;
    },

    /** 되돌릴 수 있는 판 목록. 최근 것이 앞이다. 문서는 싣지 않는다. */
    async revisions(id) {
      return [...(revisions.get(id) || [])].reverse()
        .map((r) => ({ version: r.version, title: r.title, savedAt: r.savedAt }));
    },

    /** 그 판의 문서. 없으면 null. */
    async revision(id, version) {
      const hit = (revisions.get(id) || []).find((r) => r.version === version);
      return hit ? { title: hit.title, sections: hit.sections } : null;
    },
  };
}
