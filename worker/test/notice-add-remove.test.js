import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  ENV, ITEM, NOTICE_PAGE, OUTSIDER,
  block, inPage, installNotion, run, world, writes,
} from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function call(method, path, { body, password } = {}) {
  const headers = {};
  if (password !== undefined) headers.authorization = `Bearer ${b64(password)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://relay.test${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ENV,
  );
}

const good = ENV.EDITOR_PASSWORD;
const appends = (calls) => calls.filter((c) => c.path.endsWith("/children"));
const dates = (calls) => calls.filter((c) => c.path.startsWith("/pages/"));

describe("POST /notice/item — 줄 보태기", () => {
  it("공지 맨 끝에 붙고, 새 주소와 HTML 이 돌아온다", async () => {
    const { calls } = installNotion();
    const res = await call("POST", "/notice/item", {
      body: { slug: "whiffkorea", markdown: "**7월 진행사항** 정리 완료" },
      password: good,
    });

    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.html).toBe("<b>7월 진행사항</b> 정리 완료");
    expect(out.blockId).toBeTruthy();

    const add = appends(calls);
    expect(add).toHaveLength(1);
    // 새 공지 행이 아니라 지금 공지 페이지의 자식으로 붙는다
    expect(add[0].path).toBe(`/blocks/${NOTICE_PAGE}/children`);
    expect(add[0].body.children).toHaveLength(1);
    expect(add[0].body.children[0].type).toBe("bulleted_list_item");
    expect(add[0].body.children[0].bulleted_list_item.rich_text.map(
      (r) => [r.text.content, r.annotations.bold],
    )).toEqual([["7월 진행사항", true], [" 정리 완료", false]]);
  });

  it("새 공지 행을 만들지 않는다", async () => {
    const { calls } = installNotion();
    await call("POST", "/notice/item",
               { body: { slug: "whiffkorea", markdown: "한 줄" }, password: good });

    expect(calls.filter((c) => c.method === "POST" && c.path === "/pages")).toHaveLength(0);
  });

  it("비밀번호가 없으면 401, 노션 호출이 없다", async () => {
    const { calls } = installNotion();
    const res = await call("POST", "/notice/item",
                           { body: { slug: "whiffkorea", markdown: "한 줄" } });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("모르는 슬러그면 404, 붙이지 않는다", async () => {
    const { calls } = installNotion({ share: { results: [] } });
    const res = await call("POST", "/notice/item",
                           { body: { slug: "없는기업", markdown: "한 줄" }, password: good });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });

  it("빈 내용은 422, 붙이지 않는다", async () => {
    const { calls } = installNotion();
    const res = await call("POST", "/notice/item",
                           { body: { slug: "whiffkorea", markdown: "  " }, password: good });

    expect(res.status).toBe(422);
    expect(writes(calls)).toHaveLength(0);
  });

  it("닫히지 않은 표시는 422, 붙이지 않는다", async () => {
    const { calls } = installNotion();
    const res = await call("POST", "/notice/item",
                           { body: { slug: "whiffkorea", markdown: "~~열고 안 닫음" }, password: good });

    expect(res.status).toBe(422);
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("DELETE /notice/item — 줄 지우기", () => {
  it("그 줄이 노션에서 사라지고 204", async () => {
    const { calls, blocks } = installNotion();
    const res = await call("DELETE", "/notice/item",
                           { body: { slug: "whiffkorea", blockId: ITEM }, password: good });

    expect(res.status).toBe(204);
    expect(blocks[ITEM]).toBeUndefined();
    const del = calls.filter((c) => c.method === "DELETE");
    expect(del).toHaveLength(1);
    expect(del[0].path).toBe(`/blocks/${ITEM}`);
  });

  it("비밀번호가 없으면 401, 노션 호출이 없다", async () => {
    const { calls, blocks } = installNotion();
    const res = await call("DELETE", "/notice/item",
                           { body: { slug: "whiffkorea", blockId: ITEM } });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(blocks[ITEM]).toBeTruthy();
  });

  it("다른 기업 공지의 blockId 면 404, 지우지 않는다", async () => {
    const { calls, blocks } = installNotion();
    const res = await call("DELETE", "/notice/item",
                           { body: { slug: "whiffkorea", blockId: OUTSIDER }, password: good });

    expect(res.status).toBe(404);
    expect(blocks[OUTSIDER]).toBeTruthy();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("잠긴 항목은 409, 지우지 않는다 — 첨부가 통째로 날아가면 되돌릴 수 없다", async () => {
    const { calls, blocks } = installNotion({
      blocks: world({
        [ITEM]: block(ITEM, "paragraph",
                      [run("공고문", {}, { href: "https://example.com" })], inPage(NOTICE_PAGE)),
      }),
    });
    const res = await call("DELETE", "/notice/item",
                           { body: { slug: "whiffkorea", blockId: ITEM }, password: good });

    expect(res.status).toBe(409);
    expect(blocks[ITEM]).toBeTruthy();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });
});

describe("이미 지운 항목", () => {
  it("노션 휴지통에 든 블록은 404 — 조회는 되지만 공지에는 없다", async () => {
    const { calls } = installNotion({
      blocks: world({
        [ITEM]: { ...block(ITEM, "paragraph", [run("지운 줄")], inPage(NOTICE_PAGE)),
                  archived: true, in_trash: true },
      }),
    });
    const res = await call("PUT", "/notice/item",
                           { body: { slug: "whiffkorea", blockId: ITEM, markdown: "되살리기" },
                             password: good });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("공지의 일자가 비어 있으면", () => {
  const undated = {
    results: [{ id: NOTICE_PAGE, object: "page",
                properties: { "일자": { type: "date", date: null } } }],
  };
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  it("보탤 때 오늘로 채운다 — 비면 정렬에서 밀려 화면에 아예 안 뜬다", async () => {
    const { calls } = installNotion({ notice: undated });
    const res = await call("POST", "/notice/item",
                           { body: { slug: "whiffkorea", markdown: "한 줄" }, password: good });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ dated: today });
    const patch = dates(calls);
    expect(patch).toHaveLength(1);
    expect(patch[0].body.properties["일자"].date.start).toBe(today);
  });

  it("고칠 때도 채운다", async () => {
    const { calls } = installNotion({ notice: undated });
    await call("PUT", "/notice/item",
               { body: { slug: "whiffkorea", blockId: ITEM, markdown: "고친 글" }, password: good });

    expect(dates(calls)).toHaveLength(1);
  });

  it("이미 날짜가 있으면 건드리지 않는다", async () => {
    const { calls } = installNotion();
    await call("POST", "/notice/item",
               { body: { slug: "whiffkorea", markdown: "한 줄" }, password: good });

    expect(dates(calls)).toHaveLength(0);
  });
});
