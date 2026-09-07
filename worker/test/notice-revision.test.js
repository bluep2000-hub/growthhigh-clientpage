/**
 * 판 — 저장할 때마다 직전 문서가 남고, 지난 판으로 되돌린다.
 *
 * 노션이 공짜로 주던 버전 기록을 대신한다. 없으면 담당자가 한 번 실수했을 때
 * 복구할 수단이 아예 없다(`docs/adr/0004-공지-원본-이사.md`).
 *
 * 지켜야 하는 것.
 *
 * - **남는 것은 직전 문서다.** 방금 저장한 것이 아니다 — 되돌린다는 것은
 *   「저장하기 전으로」이기 때문이다.
 * - **되돌리기도 저장이다.** 판 번호가 오르고 재빌드가 걸린다. 그래서 되돌린
 *   것도 다시 되돌릴 수 있다.
 * - **공지 하나당 최근 20판**만 남는다. 저장소가 무한정 불어나지 않는다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/store.js", () => import("./fake-store.js"));

import worker from "../src/index.js";
import { reset, seed, stored } from "./fake-store.js";
import { dispatches, ENV, installNotion } from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const good = ENV.EDITOR_PASSWORD;
const ENV_DB = { ...ENV, DB: {}, BUILD_TOKEN: "build-token-abcd" };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(() => { reset(); });

const line = (html, extra) => ({ type: "bullet", html, ...extra });

function whiff() {
  return seed({
    id: "notice-1", slug: "whiffkorea", date: "2026-07-31", title: "처음 제목", version: 1,
    sections: [{ id: "s1", title: "진행 상황",
                 items: [{ id: "n1", type: "bullet", html: "처음 줄", items: [] }] }],
  });
}

function save(body, { password = good } = {}) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request("https://relay.test/notice/doc", {
    method: "PUT", headers, body: JSON.stringify({ slug: "whiffkorea", noticeId: "notice-1",
                                                   ...body }),
  }), ENV_DB);
}

function list(query = "?slug=whiffkorea&noticeId=notice-1", { password = good } = {}) {
  const headers = {};
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request(
    `https://relay.test/notice/doc/revisions${query}`, { headers }), ENV_DB);
}

function restore(body, { password = good } = {}) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request("https://relay.test/notice/doc/restore", {
    method: "POST", headers, body: JSON.stringify({ slug: "whiffkorea", noticeId: "notice-1",
                                                    ...body }),
  }), ENV_DB);
}

describe("저장할 때마다 판이 남는다", () => {
  it("남는 것은 직전 문서다 — 방금 저장한 것이 아니다", async () => {
    installNotion();
    whiff();

    await save({ version: 1, title: "두 번째 제목", sections: [
      { id: "s1", title: "진행 상황", items: [line("두 번째 줄", { id: "n1" })] }] });
    const res = await list();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revisions).toHaveLength(1);
    expect(body.revisions[0]).toMatchObject({ version: 1, title: "처음 제목" });
  });

  it("저장할 때마다 하나씩 쌓인다", async () => {
    installNotion();
    whiff();

    for (let v = 1; v <= 3; v += 1) {
      await save({ version: v, title: `제목 ${v}`,
                   sections: [{ id: "s1", title: "칸", items: [line(`줄 ${v}`)] }] });
    }
    const body = await (await list()).json();

    // 최근 것이 앞이다. 담당자가 되돌릴 때 거의 언제나 바로 직전을 고른다
    expect(body.revisions.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(body.revisions[0].savedAt).toBeTruthy();
  });

  it("공지 하나당 최근 20판만 남는다", async () => {
    installNotion();
    whiff();

    for (let v = 1; v <= 25; v += 1) {
      await save({ version: v, title: `제목 ${v}`,
                   sections: [{ id: "s1", title: "칸", items: [line(`줄 ${v}`)] }] });
    }
    const body = await (await list()).json();

    expect(body.revisions).toHaveLength(20);
    expect(body.revisions[0].version).toBe(25);
    expect(body.revisions[19].version).toBe(6);
  });

  it("저장이 거절되면 판도 남지 않는다", async () => {
    installNotion();
    whiff();

    await save({ version: 99, title: "늦게 온 제목", sections: [] });
    const body = await (await list()).json();

    expect(body.revisions).toHaveLength(0);
  });

  it("남의 기업 슬러그로는 판 목록이 열리지 않는다", async () => {
    installNotion();
    whiff();

    const res = await list("?slug=zeroback&noticeId=notice-1");

    expect(res.status).toBe(404);
  });

  it("비밀번호가 없으면 401 이다", async () => {
    whiff();

    const res = await list("?slug=whiffkorea&noticeId=notice-1", { password: null });

    expect(res.status).toBe(401);
  });
});

describe("지난 판으로 되돌린다", () => {
  it("되돌린 판이 새 판이 된다", async () => {
    installNotion();
    whiff();
    await save({ version: 1, title: "두 번째 제목",
                 sections: [{ id: "s1", title: "칸", items: [line("두 번째 줄")] }] });

    const res = await restore({ version: 2, revision: 1 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      version: 3, title: "처음 제목",
      sections: [{ id: "s1", items: [{ id: "n1", html: "처음 줄" }] }],
    });
    expect(stored("notice-1")).toMatchObject({ version: 3, title: "처음 제목" });
  });

  it("되돌린 것도 다시 되돌릴 수 있다", async () => {
    installNotion();
    whiff();
    await save({ version: 1, title: "두 번째 제목",
                 sections: [{ id: "s1", title: "칸", items: [line("두 번째 줄")] }] });
    await restore({ version: 2, revision: 1 });          // 판 3 — 처음 것으로

    const res = await restore({ version: 3, revision: 2 });  // 다시 두 번째로

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ version: 4, title: "두 번째 제목" });
  });

  it("되돌리기도 재빌드를 부른다", async () => {
    const { calls } = installNotion();
    whiff();
    await save({ version: 1, title: "두 번째",
                 sections: [{ id: "s1", title: "칸", items: [line("두 번째 줄")] }] });
    const before = dispatches(calls).length;

    const res = await restore({ version: 2, revision: 1 });

    await expect(res.json()).resolves.toMatchObject({ rebuild: "sent" });
    expect(dispatches(calls).length).toBe(before + 1);
  });

  it("되돌리기 직전 문서도 판으로 남는다", async () => {
    installNotion();
    whiff();
    await save({ version: 1, title: "두 번째",
                 sections: [{ id: "s1", title: "칸", items: [line("두 번째 줄")] }] });

    await restore({ version: 2, revision: 1 });
    const body = await (await list()).json();

    expect(body.revisions.map((r) => r.version)).toEqual([2, 1]);
    expect(body.revisions[0].title).toBe("두 번째");
  });

  it("판 번호가 어긋나면 거절하고 지금 문서를 함께 준다", async () => {
    installNotion();
    whiff();
    await save({ version: 1, title: "두 번째", sections: [] });

    const res = await restore({ version: 1, revision: 1 });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "stale", current: { version: 2, title: "두 번째" },
    });
  });

  it("없는 판은 404 다", async () => {
    installNotion();
    whiff();

    const res = await restore({ version: 1, revision: 99 });

    expect(res.status).toBe(404);
    expect(stored("notice-1").version).toBe(1);
  });

  it("남의 기업 슬러그로는 되돌리지 못한다", async () => {
    installNotion();
    whiff();
    await save({ version: 1, title: "두 번째", sections: [] });

    const res = await worker.fetch(new Request("https://relay.test/notice/doc/restore", {
      method: "POST",
      headers: { authorization: `Bearer ${b64(good)}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "zeroback", noticeId: "notice-1",
                             version: 2, revision: 1 }),
    }), ENV_DB);

    expect(res.status).toBe(404);
    expect(stored("notice-1")).toMatchObject({ version: 2, title: "두 번째" });
  });

  it("빌드 토큰으로는 되돌리지 못한다", async () => {
    installNotion();
    whiff();

    const res = await restore({ version: 1, revision: 1 }, { password: null });

    expect(res.status).toBe(401);
  });
});
