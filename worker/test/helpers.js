/**
 * 가짜 노션. 실제 노션에 붙지 않는다.
 *
 * 테스트는 창구에 요청을 넣고 두 가지만 본다 — 무엇이 돌아왔나, 그리고
 * 노션에 무엇이 나갔나. 내부 함수를 직접 부르지 않으므로 구현을 바꿔도
 * 테스트는 깨지지 않는다.
 */

export const SHARE_DB = "21e815d7-12b9-80dc-8310-d038abd8a502";
export const NOTICE_DB = "3aa815d7-12b9-80db-a5b4-e2065ddad4a4";
export const NOTICE_PAGE = "a4a815d7-12b9-82ce-a740-01f430175bad";
export const OTHER_PAGE = "ffffffff-0000-0000-0000-000000000001";

export const ITEM = "11111111-2222-3333-4444-555555555555";
export const NESTED = "66666666-7777-8888-9999-000000000000";
export const OUTSIDER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

export const ENV = {
  NOTION_TOKEN: "secret-notion-token",
  EDITOR_PASSWORD: "editor-pw-1234",
  NOTION_VERSION: "2022-06-28",
};

const BLANK = {
  bold: false, italic: false, strikethrough: false,
  underline: false, code: false, color: "default",
};

/** rich_text 한 조각. 노션이 돌려주는 모양 그대로. */
export function run(text, annotations = {}, extra = {}) {
  return {
    type: "text",
    text: { content: text, link: null },
    annotations: { ...BLANK, ...annotations },
    plain_text: text,
    href: null,
    ...extra,
  };
}

export function block(id, type, runs, parent) {
  return { object: "block", id, type, parent, [type]: { rich_text: runs } };
}

export const inPage = (pageId) => ({ type: "page_id", page_id: pageId });
export const inBlock = (blockId) => ({ type: "block_id", block_id: blockId });

/** 기본 세계 — 공지 한 건에 항목 두 개(하나는 한 겹 안쪽). */
export function world(extra = {}) {
  return {
    [ITEM]: block(ITEM, "bulleted_list_item",
                  [run("연구주제 : 패키지 디자인 개발")], inPage(NOTICE_PAGE)),
    [NESTED]: block(NESTED, "to_do", [run("현장실사 완료")], inBlock(ITEM)),
    [OUTSIDER]: block(OUTSIDER, "paragraph",
                      [run("남의 기업 공지")], inPage(OTHER_PAGE)),
    ...extra,
  };
}

/**
 * 노션을 가로챈다. 오간 요청을 전부 기록해 돌려준다.
 *
 * @param {object} opts
 * @param {object} [opts.blocks]    id → 블록
 * @param {object} [opts.share]     공유페이지 DB 조회 결과를 갈아끼운다
 * @param {object} [opts.notice]    공지 DB 조회 결과를 갈아끼운다
 * @param {function} [opts.fail]    (method, path) → 응답을 가로채 실패시킨다
 */
export function installNotion(opts = {}) {
  const blocks = opts.blocks || world();
  const calls = [];

  const share = opts.share ?? {
    results: [{
      id: "share-row",
      properties: {
        "슬러그": { type: "rich_text", rich_text: [run("whiffkorea")] },
        "공지 DB": { type: "url", url: `https://app.notion.com/p/${NOTICE_DB.replace(/-/g, "")}?v=abc` },
      },
    }],
  };

  const notice = opts.notice ?? {
    results: [{
      id: NOTICE_PAGE, object: "page",
      properties: { "일자": { type: "date", date: { start: "2026-07-31" } } },
    }],
  };

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    const auth = (init.headers || {}).authorization;
    calls.push({ method, path, body, auth });

    const forced = opts.fail?.(method, path);
    if (forced) return forced;

    const reply = (data, status = 200) =>
      new Response(JSON.stringify(data), { status });

    if (method === "POST" && path === `/databases/${SHARE_DB}/query`) return reply(share);
    if (method === "GET" && path === `/databases/${NOTICE_DB}`) {
      return reply({ object: "database", id: NOTICE_DB });
    }
    if (method === "POST" && path === `/databases/${NOTICE_DB}/query`) return reply(notice);

    const pm = /^\/pages\/([^/]+)$/.exec(path);
    if (pm && method === "PATCH") return reply({ object: "page", id: pm[1], ...body });

    const cm = /^\/blocks\/([^/]+)\/children$/.exec(path);
    if (cm && method === "PATCH") {
      const made = body.children.map((c, i) => ({
        object: "block", id: `new-block-${i}`, type: c.type,
        parent: inBlock(cm[1]), [c.type]: { rich_text: toPlain(c[c.type].rich_text) },
      }));
      for (const b of made) blocks[b.id] = { ...b, parent: inPage(cm[1]) };
      return reply({ results: made });
    }

    const bm = /^\/blocks\/([^/]+)$/.exec(path);
    if (bm) {
      const found = blocks[bm[1]];
      if (!found) return reply({ message: "block not found" }, 404);
      if (method === "GET") return reply(found);
      if (method === "PATCH") {
        const type = found.type;
        const updated = { ...found, [type]: { rich_text: toPlain(body[type].rich_text) } };
        blocks[bm[1]] = updated;
        return reply(updated);
      }
      if (method === "DELETE") {
        delete blocks[bm[1]];
        return reply({ ...found, archived: true });
      }
    }

    return reply({ message: `가짜 노션이 모르는 경로: ${method} ${path}` }, 404);
  };

  return { calls, blocks };
}

/** 노션은 보낸 rich_text 에 plain_text 를 채워 돌려준다. 그 흉내. */
function toPlain(runs) {
  return runs.map((r) => ({ ...r, plain_text: r.text?.content ?? "", href: r.text?.link?.url ?? null }));
}

/** 노션에 나간 쓰기 요청만. 「안 썼다」를 확인할 때 쓴다. */
export const writes = (calls) => calls.filter((c) => c.method !== "GET" && !c.path.endsWith("/query"));
