/**
 * `GET /notice/tree` — 편집 모드가 고칠 글을 받아 가는 창구.
 *
 * 봉투에 실린 HTML 은 표시용이라 rich_text 로 되돌릴 수 없다. 편집 모드는
 * 노션에서 원본을 새로 읽어야 하고, 그 길이 여기다. 여기서 받은
 * `last_edited_time` 이 저장할 때 보내는 `seen` 의 기준선이 된다.
 */

import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  EDITED, ENV, ITEM, NESTED, NOTICE_PAGE, OTHER_PAGE, OUTSIDER,
  block, inBlock, inPage, installNotion, run, world,
} from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const good = ENV.EDITOR_PASSWORD;

/** 비밀번호를 빼고 부르려면 `{ password: null }` 을 준다. */
function tree(query, { password = good } = {}) {
  const headers = {};
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(
    new Request(`https://relay.test/notice/tree${query}`, { headers }), ENV);
}

describe("담당자만 연다", () => {
  it("비밀번호가 없으면 401, 노션에 닿지 않는다", async () => {
    const { calls } = installNotion();
    const res = await tree("?slug=whiffkorea", { password: null });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("모르는 슬러그면 404", async () => {
    installNotion({ share: { results: [] } });
    expect((await tree("?slug=없는기업")).status).toBe(404);
  });

  it("슬러그가 없으면 422", async () => {
    installNotion();
    expect((await tree("")).status).toBe(422);
  });
});

describe("그 기업 공지의 모든 블록을 주소를 열쇠로 돌려준다", () => {
  it("납작한 뭉치다 — 중첩된 항목도 같은 켜에 온다", async () => {
    installNotion();
    const body = await (await tree("?slug=whiffkorea")).json();

    expect(body.pageId).toBe(NOTICE_PAGE);
    expect(Object.keys(body.items).sort()).toEqual([ITEM, NESTED].sort());
    expect(body.more).toEqual([]);
  });

  it("항목마다 편집용 HTML · 종류 · 수정시각이 있다", async () => {
    installNotion({ blocks: {
      [ITEM]: block(ITEM, "bulleted_list_item", [
        run("굵게", { bold: true }), run(" 그리고 "),
        run("링크", {}, { href: "https://example.com/a" })], inPage(NOTICE_PAGE)),
    } });
    const body = await (await tree("?slug=whiffkorea")).json();

    expect(body.items[ITEM]).toEqual({
      type: "bulleted_list_item",
      last_edited_time: EDITED,
      html: '<strong>굵게</strong> 그리고 <a href="https://example.com/a">링크</a>',
    });
  });

  it("할 일 항목은 체크 상태도 함께 온다", async () => {
    installNotion({ blocks: {
      [ITEM]: block(ITEM, "to_do", [run("현장실사")], inPage(NOTICE_PAGE),
                    { to_do: { rich_text: [run("현장실사")], checked: true } }),
    } });
    const body = await (await tree("?slug=whiffkorea")).json();

    expect(body.items[ITEM].checked).toBe(true);
  });

  it("남의 기업 공지에 있는 블록은 오지 않는다", async () => {
    installNotion({ blocks: {
      ...world(),
      "남의-줄": block("남의-줄", "paragraph", [run("남의 기업")], inPage(OTHER_PAGE)),
    } });
    const body = await (await tree("?slug=whiffkorea")).json();

    expect(body.items).not.toHaveProperty(OUTSIDER);
    expect(body.items).not.toHaveProperty("남의-줄");
  });
});

describe("왜 못 고치는지 함께 준다", () => {
  it("링크 카드가 든 항목은 잠긴다", async () => {
    installNotion({ blocks: {
      [ITEM]: block(ITEM, "paragraph", [
        run("공고 "),
        { type: "mention", mention: { type: "link_mention", link_mention: { id: "lm" } },
          annotations: {}, plain_text: "https://example.com/x", href: null },
      ], inPage(NOTICE_PAGE)),
    } });
    const body = await (await tree("?slug=whiffkorea")).json();

    expect(body.items[ITEM].locked).toBe("링크 카드");
  });

  it("첨부·이모지·글자색이 든 항목은 이제 잠기지 않는다", async () => {
    installNotion({ blocks: {
      "색": block("색", "paragraph", [run("빨강", { color: "red" })], inPage(NOTICE_PAGE)),
      "이모지": block("이모지", "paragraph", [
        { type: "mention", mention: { type: "custom_emoji", custom_emoji: { id: "e1" } },
          annotations: {}, plain_text: ":도장:", href: null }], inPage(NOTICE_PAGE)),
      "밑줄": block("밑줄", "quote", [run("밑줄", { underline: true })], inPage(NOTICE_PAGE)),
    } });
    const body = await (await tree("?slug=whiffkorea")).json();

    for (const id of ["색", "이모지", "밑줄"]) {
      expect(body.items[id], id).not.toHaveProperty("locked");
    }
  });

  it("표·첨부·하위 문서는 아직 잠긴 채로 온다", async () => {
    installNotion({ blocks: {
      "표": { object: "block", id: "표", type: "table", parent: inPage(NOTICE_PAGE),
             last_edited_time: EDITED, table: { table_width: 3 } },
      "첨부": { object: "block", id: "첨부", type: "file", parent: inPage(NOTICE_PAGE),
               last_edited_time: EDITED, file: {} },
      "문서": { object: "block", id: "문서", type: "child_page", parent: inPage(NOTICE_PAGE),
               last_edited_time: EDITED, child_page: { title: "회의록" } },
    } });
    const body = await (await tree("?slug=whiffkorea")).json();

    expect(body.items["표"].locked).toBe("표");
    expect(body.items["첨부"].locked).toBe("첨부");
    expect(body.items["문서"].locked).toBe("문서");
    // 잠겨 있어도 주소와 수정시각은 갖는다 — 지우기는 뒤 티켓에서 열린다.
    expect(body.items["표"].last_edited_time).toBe(EDITED);
  });

  it("표 안과 하위 문서 안까지는 들어가지 않는다", async () => {
    const { calls } = installNotion({ blocks: {
      "표": { object: "block", id: "표", type: "table", parent: inPage(NOTICE_PAGE),
             last_edited_time: EDITED, table: { table_width: 2 } },
      "행": { object: "block", id: "행", type: "table_row", parent: inBlock("표"),
             last_edited_time: EDITED, table_row: { cells: [] } },
      "문서": { object: "block", id: "문서", type: "child_page", parent: inPage(NOTICE_PAGE),
               last_edited_time: EDITED, child_page: { title: "회의록" } },
      "문서속": block("문서속", "paragraph", [run("안쪽")], inBlock("문서")),
    } });
    const body = await (await tree("?slug=whiffkorea")).json();

    expect(Object.keys(body.items).sort()).toEqual(["문서", "표"]);
    expect(calls.filter((c) => c.path.endsWith("/children"))).toHaveLength(1);
  });
});

describe("한 번에 다 못 읽으면 이어서 읽는다", () => {
  /** 자식이 한 겹씩 이어지는 깊은 공지. 자식 조회가 켜마다 한 번씩 든다. */
  function deepWorld(depth) {
    const blocks = {};
    let parent = inPage(NOTICE_PAGE);
    for (let i = 0; i < depth; i += 1) {
      const id = `깊이-${i}`;
      blocks[id] = block(id, "toggle", [run(`${i}단`)], parent);
      parent = inBlock(id);
    }
    return blocks;
  }

  it("못 다 본 곳을 more 로 알려 주고, 그것을 들고 다시 부르면 끝까지 온다", async () => {
    installNotion({ blocks: deepWorld(60) });

    const first = await (await tree("?slug=whiffkorea")).json();
    expect(first.more.length).toBeGreaterThan(0);
    expect(Object.keys(first.items).length).toBeLessThan(60);

    const items = { ...first.items };
    let more = first.more;
    for (let round = 0; round < 10 && more.length; round += 1) {
      const next = await (await tree(
        `?slug=whiffkorea&more=${encodeURIComponent(more.join(","))}`)).json();
      Object.assign(items, next.items);
      more = next.more;
    }

    expect(more).toEqual([]);
    expect(Object.keys(items)).toHaveLength(60);
  });
});
