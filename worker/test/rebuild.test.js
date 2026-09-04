import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import { ENV, ITEM, dispatches, installNotion, writes } from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function call(method, path, { body, password, env } = {}) {
  const headers = {};
  if (password !== undefined) headers.authorization = `Bearer ${b64(password)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://relay.test${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env || ENV,
  );
}

const good = ENV.EDITOR_PASSWORD;
const edit = { slug: "whiffkorea", blockId: ITEM, markdown: "고친 글" };

describe("쓰기에 성공하면 재빌드 신호를 던진다", () => {
  it("고치기 — 슬러그와 함께 한 번", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", { body: edit, password: good });

    expect(res.status).toBe(200);
    const sent = dispatches(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "POST",
      path: `/repos/${ENV.GITHUB_REPO}/dispatches`,
      body: { event_type: "rebuild", client_payload: { slug: "whiffkorea" } },
    });
  });

  it("보태기 — 한 번", async () => {
    const { calls } = installNotion();
    await call("POST", "/notice/item",
               { body: { slug: "whiffkorea", markdown: "한 줄" }, password: good });

    expect(dispatches(calls)).toHaveLength(1);
  });

  it("지우기 — 한 번", async () => {
    const { calls } = installNotion();
    await call("DELETE", "/notice/item",
               { body: { slug: "whiffkorea", blockId: ITEM }, password: good });

    expect(dispatches(calls)).toHaveLength(1);
  });
});

describe("쓰지 않았으면 신호도 던지지 않는다", () => {
  it("노션이 5xx 를 주면", async () => {
    const { calls } = installNotion({
      fail: (method, path) =>
        (method === "PATCH" && path.startsWith("/blocks/"))
          ? new Response(JSON.stringify({ message: "conflict_error" }), { status: 502 })
          : null,
    });
    const res = await call("PUT", "/notice/item", { body: edit, password: good });

    expect(res.status).toBe(502);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("비밀번호가 틀리면", async () => {
    const { calls } = installNotion();
    await call("PUT", "/notice/item", { body: edit, password: "wrong-pw" });

    expect(dispatches(calls)).toHaveLength(0);
  });

  it("잠긴 항목이면", async () => {
    const { calls } = installNotion();
    await call("PUT", "/notice/item",
               { body: { ...edit, markdown: "**닫지 않음" }, password: good });

    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });
});

describe("신호가 실패해도 담당자의 저장은 성공이다", () => {
  it("GitHub 이 거절해도 200 — 노션에는 이미 들어갔다", async () => {
    const { calls } = installNotion({ dispatchFails: true });
    const res = await call("PUT", "/notice/item", { body: edit, password: good });

    expect(res.status).toBe(200);
    // 다만 「1~2분 뒤」가 거짓말이 되지 않게 화면에는 알려 준다
    await expect(res.json()).resolves.toMatchObject({ rebuild: "failed" });
    expect(writes(calls)).toHaveLength(1);
  });

  it("신호용 토큰이 아직 없으면 조용히 건너뛴다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", {
      body: edit, password: good,
      env: { ...ENV, GITHUB_DISPATCH_TOKEN: "" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ rebuild: "skipped" });
    expect(dispatches(calls)).toHaveLength(0);
  });
});
