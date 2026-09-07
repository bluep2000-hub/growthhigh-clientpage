/**
 * 노션 호출과, 슬러그에서 「지금 화면에 떠 있는 공지」를 찾아가는 길.
 *
 * 찾아가는 규칙은 빌더(`src/build_client.py` 의 `fetch_notice`)와 같아야 한다.
 * 서로 다른 공지를 잡으면 담당자는 화면에 없는 줄을 고치게 된다.
 */

import { foreign, notFound, upstream } from "./error.js";

const API = "https://api.notion.com/v1";

/** 공유페이지 DB (클라이언트 레지스트리). 빌더의 SHARE_DB_ID 와 같다. */
export const SHARE_DB_ID = "21e815d7-12b9-80dc-8310-d038abd8a502";

/** 섹션을 여는 블록. 빌더의 NOTICE_HEADING_TYPES 와 같다. */
export const HEADING_TYPES = new Set(["heading_1", "heading_2", "heading_3"]);

/**
 * 안쪽을 그대로 펴는 그릇. 빌더의 NOTICE_PASSTHRU_TYPES 와 같다.
 * 제목을 품은 callout 도 빌더가 껍데기로 보아 펴므로 여기에 함께 둔다.
 */
export const SHELL_TYPES = new Set(["column_list", "column", "synced_block", "callout"]);

/** 이 블록의 부모 주소. 페이지 밑이면 페이지 주소다. */
export function parentIdOf(block) {
  const p = block?.parent || {};
  return p.type === "page_id" ? p.page_id : p.block_id;
}

/** 공지에서 항목이 되는 블록. 빌더의 NOTICE_ITEM_TYPES 와 같다. */
export const ITEM_TYPES = new Set([
  "to_do", "bulleted_list_item", "numbered_list_item", "paragraph", "toggle", "quote",
]);

const HEX32 = /[0-9a-f]{32}/gi;

/** 공지 URL 에서 32자 hex 를 뽑아 UUID 로. 빌더의 `notice_source_id` 와 같다. */
export function sourceIdFromUrl(url) {
  if (!url) return null;
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url);
  }
  const hits = path.match(HEX32);
  if (!hits) return null;
  const h = hits[hits.length - 1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * 노션 호출 하나. 실패는 전부 502 로 감싸 노션이 준 사유를 그대로 붙인다.
 * 404 만은 그대로 살려 보낸다 — 「없는 것」과 「노션이 고장난 것」은 다르다.
 */
export function createNotion(env) {
  const token = env.NOTION_TOKEN;
  const version = env.NOTION_VERSION || "2022-06-28";

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "notion-version": version,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw upstream(`노션에 닿지 못했습니다: ${e.message}`);
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* 노션이 JSON 이 아닌 것을 준 경우. 아래에서 502 가 된다. */
    }

    if (res.status === 404) throw notFound(data?.message || path);
    if (!res.ok) throw upstream(data?.message || `${res.status} ${text.slice(0, 200)}`);
    if (data === null) throw upstream("노션 응답을 읽지 못했습니다");
    return data;
  }

  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    patch: (p, b) => call("PATCH", p, b),
    del: (p) => call("DELETE", p),
  };
}

/** 담당자가 사는 시간대의 오늘. UTC 로 적으면 저녁에 쓴 공지가 어제로 남는다. */
export function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 제목 속성의 이름. **이름이 아니라 title 타입으로 찾는다.**
 *
 * 빌더의 `first_title_prop` 과 같은 규칙이다. 위프코리아 공지 DB 의 제목
 * 속성명은 「상세내용」이고, 기업마다 다르다.
 */
export function titleProp(properties) {
  for (const [name, v] of Object.entries(properties || {})) {
    if (v?.type === "title") return name;
  }
  return null;
}

/** 그 페이지의 제목 글자. 서식은 버린다 — 화면의 제목 칸이 글자만 다룬다. */
export function plainTitle(page) {
  const name = titleProp(page?.properties);
  if (!name) return "";
  const runs = page.properties[name].title || [];
  return runs.map((r) => r.plain_text ?? r.text?.content ?? "").join("").trim();
}

/**
 * 슬러그 → 공유페이지 DB 의 그 기업 행. 없으면 404.
 *
 * **아는 기업인지만 묻는다.** 공지가 한 건도 없어도 통과한다 — 저장소에 첫
 * 공지를 만드는 자리에서는 그것이 실패가 아니라 만들어야 할 까닭이다.
 * 그 자리는 「공지 DB」 속성을 읽지 않으므로(공지의 원본이 저장소로 옮겨
 * 왔다) 이 확인만 지난다.
 */
export async function findClient(nt, slug) {
  if (!slug) throw notFound("슬러그가 없습니다");

  const rows = await nt.post(`/databases/${SHARE_DB_ID}/query`, {
    filter: { property: "슬러그", rich_text: { equals: slug } },
    page_size: 2,
  });
  const client = (rows.results || [])[0];
  if (!client) throw notFound(`모르는 슬러그: ${slug}`);
  return client;
}

/**
 * 슬러그 → 공지 원천과, 그 안에서 지금 화면에 떠 있는 공지.
 *
 * **공지가 하나도 없어도 던지지 않는다.** 새 공지를 만드는 자리에서는 그것이
 * 실패가 아니라 만들어야 할 까닭이다 — 첫 공지를 노션에서 만들게 하지 않는다.
 *
 * @returns {Promise<{db: object|null, dbId: string, page: object|null,
 *                    fromDatabase: boolean}>}
 */
export async function findNoticeSource(nt, slug) {
  const client = await findClient(nt, slug);

  const noticeUrl = client.properties?.["공지 DB"]?.url;
  const sourceId = sourceIdFromUrl(noticeUrl);
  if (!sourceId) throw notFound(`${slug} 에 공지 DB 가 없습니다`);

  // DB 인지 페이지인지 주소 모양으로는 알 수 없다. 빌더처럼 차례로 물어본다.
  let source = null;
  for (const path of [`/databases/${sourceId}`, `/pages/${sourceId}`]) {
    try {
      source = await nt.get(path);
      break;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  if (!source) throw notFound(`공지 원천을 열지 못했습니다: ${sourceId}`);

  if (source.object !== "database") {
    return { db: null, dbId: sourceId, page: source, fromDatabase: false };
  }

  const res = await nt.post(`/databases/${sourceId}/query`, {
    sorts: [{ property: "일자", direction: "descending" }],
    page_size: 1,
  });
  return { db: source, dbId: sourceId,
           page: (res.results || [])[0] || null, fromDatabase: true };
}

/**
 * 슬러그 → 지금 클라이언트 페이지에 떠 있는 공지의 페이지 id.
 *
 * 빌더와 같은 규칙이다. 공지 원천이 DB 면 `일자` 내림차순 첫 행이 공지고,
 * 일반 페이지면 그 페이지가 곧 공지다.
 */
export async function findNoticePage(nt, slug) {
  const src = await findNoticeSource(nt, slug);
  if (!src.page) throw notFound(`${slug} 의 공지가 비어 있습니다`);
  return { pageId: src.page.id, page: src.page, db: src.db, dbId: src.dbId,
           fromDatabase: src.fromDatabase };
}

/**
 * 한 블록의 자식 전부. 노션은 100개씩만 준다.
 */
export async function listChildren(nt, blockId) {
  const out = [];
  let cursor = null;
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await nt.get(`/blocks/${blockId}/children${q}`);
    out.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

/**
 * 자식을 더 읽지 않는 블록.
 *
 * 하위 문서는 다른 페이지다 — 그 안까지 열면 공지가 아닌 것을 고치게 된다.
 * 표는 아직 다루는 코드가 없다(#26). 위프코리아 공지의 표 행이 400개가 넘어,
 * 지금 읽어 봐야 쓰지도 않을 것을 위해 왕복만 몇 배로 늘린다.
 */
const NO_DESCENT = new Set(["child_page", "table"]);

/**
 * 공지 한 건의 블록을 훑는다. **한 번에 다 훑지 않는다.**
 *
 * Cloudflare Workers 는 요청 하나가 낼 수 있는 바깥 호출 수에 상한이 있다
 * (무료 50 · 유료 1000). 위프코리아 공지는 표를 건너뛰어도 자식 조회가 49번
 * 걸려 무료 상한에 그대로 닿는다. 그래서 한 요청이 쓰는 조회 수를 정해 두고,
 * 못 다 본 곳은 `more` 로 돌려준다 — 화면이 그것을 들고 다시 부른다.
 *
 * @param {object[]} roots 이번에 자식을 읽을 블록·페이지 주소
 * @param {number} budget  이번 요청에서 쓸 자식 조회 횟수
 * @returns {Promise<{blocks: object[], more: string[]}>}
 */
export async function walkChildren(nt, roots, budget) {
  const blocks = [];
  const queue = [...roots];
  let spent = 0;

  while (queue.length && spent < budget) {
    const id = queue.shift();
    spent += 1;
    for (const b of await listChildren(nt, id)) {
      blocks.push(b);
      if (b.has_children && !NO_DESCENT.has(b.type)) queue.push(b.id);
    }
  }
  return { blocks, more: queue };
}

/**
 * 공지 행의 `일자` 가 비어 있으면 오늘로 채운다.
 *
 * 빌더가 `일자` 내림차순으로 첫 행만 공지로 올린다. 비어 있는 행은 정렬에서
 * 밀려 **화면에 아예 뜨지 않는다** — 담당자는 저장했는데 아무 데도 안 보이는
 * 일을 겪는다. 고치거나 보탠 김에 채워 둔다.
 */
export async function ensureNoticeDate(nt, notice) {
  if (!notice.fromDatabase) return null;
  if (notice.page?.properties?.["일자"]?.date?.start) return null;

  const today = todayKst();
  await nt.patch(`/pages/${notice.pageId}`, {
    properties: { "일자": { date: { start: today } } },
  });
  return today;
}

/**
 * 이 블록이 정말 그 기업의 공지 안에 있는가. 부모를 타고 올라가 확인한다.
 *
 * 이 확인이 없으면 blockId 하나로 워크스페이스 전체를 고칠 수 있다. 담당자
 * 비밀번호는 담당자 전원이 나눠 쓰는 값이라 「아는 사람만 쓴다」에 기댈 수 없다.
 */
export async function assertBlockInPage(nt, blockId, pageId,
                                       ancestors = new Map(), maxDepth = 12) {
  const target = await nt.get(`/blocks/${blockId}`);

  // 노션의 삭제는 휴지통으로 보내는 것이라 지운 블록도 조회는 된다.
  // 화면에는 이미 없는 줄이므로 공지 항목으로 치지 않는다.
  if (target.archived || target.in_trash) throw notFound("이미 지운 항목입니다");

  let cur = target;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = cur.parent || {};
    if (parent.type === "page_id") {
      if (sameId(parent.page_id, pageId)) return target;
      throw foreign("그 기업의 공지에 없는 항목입니다");
    }
    if (parent.type !== "block_id") {
      throw foreign("그 기업의 공지에 없는 항목입니다");
    }
    // 한 번의 저장에서 여러 항목이 같은 조상을 타고 오른다. 조상만 기억해
    // 두고 고칠 블록 자체는 늘 새로 읽는다 — 그것이 어긋남 판정의 근거다.
    const up = parent.block_id;
    if (ancestors.has(up)) {
      cur = ancestors.get(up);
    } else {
      cur = await nt.get(`/blocks/${up}`);
      ancestors.set(up, cur);
    }
  }
  // 공지는 4단 정도까지 중첩된다. 여기까지 왔으면 공지 바깥이거나 순환이다.
  throw foreign("공지 안에서 찾지 못했습니다");
}

/** 하이픈 유무·대소문자가 달라도 같은 id 로 본다. */
export function sameId(a, b) {
  const norm = (v) => String(v || "").replace(/-/g, "").toLowerCase();
  const x = norm(a);
  return Boolean(x) && x === norm(b);
}
