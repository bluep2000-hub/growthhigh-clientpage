/**
 * `POST /notice/item` 의 `sectionId` — 보탠 줄이 그 섹션 안에 들어간다.
 *
 * 노션은 이미 있는 블록을 옮기지 못한다(ADR 0003). 그래서 맨 끝에 붙였다가
 * 끌어 올리는 길은 없고, 처음부터 그 자리에 넣어야 한다. 붙일 자리를 고르는
 * 것은 받아 준다 — `position: {type:"after_block"}`.
 *
 * 섹션은 빌더와 같은 규칙으로 가른다. 제목 블록이 섹션을 열고, 다음 제목
 * 앞까지가 그 섹션이다.
 */

import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  ENV, EDITED, NOTICE_PAGE, OTHER_PAGE, OUTSIDER,
  block, inBlock, inPage, installNotion, run,
} from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const good = ENV.EDITOR_PASSWORD;

function add(body) {
  return worker.fetch(
    new Request("https://relay.test/notice/item", {
      method: "POST",
      headers: { authorization: `Bearer ${b64(good)}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "whiffkorea", markdown: "새 줄", ...body }),
    }),
    ENV,
  );
}

const appended = (calls) => calls.find((c) => c.path.endsWith("/children") && c.method === "PATCH");

const heading = (id, text) => ({
  object: "block", id, type: "heading_2", parent: inPage(NOTICE_PAGE),
  last_edited_time: EDITED, heading_2: { rich_text: [run(text)] },
});

/**
 * 머리말 한 줄 · 제목 둘 · 각 섹션의 줄들.
 *
 * 순서가 곧 노션의 순서다 — 가짜 노션이 꽂힌 차례대로 자식을 돌려준다.
 */
function sectioned() {
  return {
    "머리말": block("머리말", "paragraph", [run("이번 달 요약")], inPage(NOTICE_PAGE)),
    "제목가": heading("제목가", "진행 사항"),
    "가1": block("가1", "bulleted_list_item", [run("서류 접수")], inPage(NOTICE_PAGE)),
    "가2": block("가2", "bulleted_list_item", [run("현장 실사")], inPage(NOTICE_PAGE)),
    "제목나": heading("제목나", "다음 달 계획"),
    "나1": block("나1", "bulleted_list_item", [run("보완 서류")], inPage(NOTICE_PAGE)),
    [OUTSIDER]: block(OUTSIDER, "paragraph", [run("남의 기업 공지")], inPage(OTHER_PAGE)),
  };
}

describe("섹션을 고르면 그 섹션 맨 끝에 붙는다", () => {
  it("가운데 섹션이면 다음 제목 바로 앞에 들어간다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    const res = await add({ sectionId: "제목가" });

    expect(res.status).toBe(201);
    expect(appended(calls).body.position).toEqual({
      type: "after_block", after_block: { id: "가2" },
    });
  });

  it("마지막 섹션이면 공지 맨 끝에 들어간다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    await add({ sectionId: "제목나" });

    expect(appended(calls).body.position).toEqual({
      type: "after_block", after_block: { id: "나1" },
    });
  });

  it("빈 섹션이면 제목 바로 뒤에 들어간다", async () => {
    const blocks = sectioned();
    delete blocks["나1"];
    const { calls } = installNotion({ blocks });
    await add({ sectionId: "제목나" });

    expect(appended(calls).body.position).toEqual({
      type: "after_block", after_block: { id: "제목나" },
    });
  });
});

describe("제목 없이 시작하는 첫 구역", () => {
  it("첫 제목 바로 앞에 들어간다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    await add({ sectionId: "start" });

    expect(appended(calls).body.position).toEqual({
      type: "after_block", after_block: { id: "머리말" },
    });
  });

  it("공지가 제목으로 시작하면 맨 앞에 들어간다", async () => {
    const blocks = sectioned();
    delete blocks["머리말"];
    const { calls } = installNotion({ blocks });
    await add({ sectionId: "start" });

    expect(appended(calls).body.position).toEqual({ type: "start" });
  });
});

describe("제목이 콜아웃·컬럼 안에 있을 때", () => {
  /**
   * 실제 공지의 흔한 모양이다. 위프코리아 공지는 최상위 제목이 0개이고
   * 다섯 개가 전부 콜아웃 안에 있었다. 최상위만 훑으면 그 회사의 섹션은
   * 통째로 「남의 것」이 된다.
   */
  function inCallout() {
    return {
      "겉": { object: "block", id: "겉", type: "callout", parent: inPage(NOTICE_PAGE),
             last_edited_time: EDITED, callout: { rich_text: [] } },
      "속제목": { object: "block", id: "속제목", type: "heading_2", parent: inBlock("겉"),
                 last_edited_time: EDITED, heading_2: { rich_text: [run("진행 사항")] } },
      "속1": block("속1", "bulleted_list_item", [run("서류 접수")], inBlock("겉")),
      "속2": block("속2", "bulleted_list_item", [run("현장 실사")], inBlock("겉")),
      "꼬리": block("꼬리", "paragraph", [run("맺음말")], inPage(NOTICE_PAGE)),
    };
  }

  it("제목이 든 그릇 안에, 그 섹션 맨 끝에 붙는다", async () => {
    const { calls } = installNotion({ blocks: inCallout() });
    const res = await add({ sectionId: "속제목" });

    expect(res.status).toBe(201);
    const put = appended(calls);
    // 공지 페이지가 아니라 제목과 같은 그릇에 붙는다 — 아니면 섹션 밖으로 나간다
    expect(put.path).toBe("/blocks/겉/children");
    expect(put.body.position).toEqual({ type: "after_block", after_block: { id: "속2" } });
  });

  it("그릇 안 제목이라도 남의 기업 것이면 거절한다", async () => {
    const blocks = inCallout();
    blocks["남의겉"] = { object: "block", id: "남의겉", type: "callout",
                        parent: inPage(OTHER_PAGE), last_edited_time: EDITED,
                        callout: { rich_text: [] } };
    blocks["남의제목"] = { object: "block", id: "남의제목", type: "heading_2",
                          parent: inBlock("남의겉"), last_edited_time: EDITED,
                          heading_2: { rich_text: [run("남의 섹션")] } };
    const { calls } = installNotion({ blocks });
    const res = await add({ sectionId: "남의제목" });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_mine");
    expect(appended(calls)).toBeUndefined();
  });

  it("제목 없는 첫 구역은 제목을 품은 그릇 앞에서 끝난다", async () => {
    const blocks = inCallout();
    blocks["머리말"] = block("머리말", "paragraph", [run("이번 달 요약")], inPage(NOTICE_PAGE));
    // 머리말이 겉보다 먼저 오게 다시 꽂는다 — 가짜 노션은 꽂은 차례로 준다
    const ordered = { "머리말": blocks["머리말"] };
    for (const [k, v] of Object.entries(blocks)) if (k !== "머리말") ordered[k] = v;

    const { calls } = installNotion({ blocks: ordered });
    await add({ sectionId: "start" });

    expect(appended(calls).body.position).toEqual({
      type: "after_block", after_block: { id: "머리말" },
    });
  });
});

describe("고르지 않았을 때와 잘못 골랐을 때", () => {
  it("섹션을 안 보내면 예전처럼 공지 맨 끝이다 — 자리를 지정하지 않는다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    const res = await add({});

    expect(res.status).toBe(201);
    expect(appended(calls).body.position).toBeUndefined();
    // 자리를 안 고르면 자식 목록을 읽을 까닭도 없다
    expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/children")))
      .toHaveLength(0);
  });

  it("남의 기업 공지의 섹션이면 거절하고 아무것도 쓰지 않는다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    const res = await add({ sectionId: OUTSIDER });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_mine");
    expect(appended(calls)).toBeUndefined();
  });

  it("제목이 아닌 줄을 섹션이라고 하면 거절한다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    const res = await add({ sectionId: "가1" });

    expect(res.status).toBe(422);
    expect((await res.json()).detail).toBe("섹션 제목이 아닙니다");
    expect(appended(calls)).toBeUndefined();
  });
});
