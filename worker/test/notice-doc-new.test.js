/**
 * 저장소에 새 공지를 만든다 — `POST /notice/doc`.
 *
 * 이사한 뒤 저장소가 비어 있으므로 **모든 기업의 첫 공지가 이 길로 만들어진다.**
 * 첫 공지를 만들려고 노션을 여는 일이 없어진다.
 *
 * 지켜야 하는 것.
 *
 * - **하루에 하나다.** 오늘 날짜 공지가 이미 있으면 또 만들지 않고 그리로
 *   보낸다. 같은 날짜가 둘이면 화면에 오르는 것이 어느 쪽인지 정할 수 없어,
 *   담당자는 클라이언트에게 보이지 않는 공지에 적게 된다.
 * - **재빌드를 부르지 않는다.** 갓 만든 공지는 비어 있고, 빈 공지가 나가면
 *   클라이언트 화면에서 공지가 통째로 사라진다. 첫 줄을 적고 저장할 때
 *   함께 나간다.
 * - **모르는 슬러그로는 만들 수 없다.** 저장소는 그 슬러그가 진짜 기업인지
 *   모른다 — 공지가 한 건도 없는 기업이 바로 이 창구의 손님이기 때문이다.
 *   그래서 공유페이지 DB 에 그 기업이 있는지 노션에 묻는다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/store.js", () => import("./fake-store.js"));

import worker from "../src/index.js";
import { all, reset, seed } from "./fake-store.js";
import { dispatches, ENV, installNotion, writes } from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const good = ENV.EDITOR_PASSWORD;
const ENV_DB = { ...ENV, DB: {} };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(() => { reset(); });

/** 담당자가 사는 시간대. 중계 서버가 날짜를 매기는 규칙과 같다. */
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function make(body = { slug: "whiffkorea" }, { password = good } = {}) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request("https://relay.test/notice/doc", {
    method: "POST", headers, body: JSON.stringify(body),
  }), ENV_DB);
}

describe("POST /notice/doc", () => {
  it("공지가 한 건도 없어도 오늘 날짜로 빈 공지를 만든다", async () => {
    installNotion();

    const res = await make();

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      slug: "whiffkorea", date: todayKst(), title: "", version: 1, sections: [],
    });
    expect(body.noticeId).toBeTruthy();
    expect(all()).toHaveLength(1);
  });

  it("만든 공지는 그대로 다시 읽힌다", async () => {
    installNotion();

    const made = await (await make()).json();
    const res = await worker.fetch(new Request(
      "https://relay.test/notice/doc?slug=whiffkorea",
      { headers: { authorization: `Bearer ${b64(good)}` } },
    ), ENV_DB);

    await expect(res.json()).resolves.toMatchObject({ noticeId: made.noticeId, version: 1 });
  });

  it("오늘 날짜 공지가 이미 있으면 또 만들지 않고 그리로 보낸다", async () => {
    installNotion();
    seed({ id: "오늘것", slug: "whiffkorea", date: todayKst(),
           title: "적다 만 공지", version: 2 });

    const res = await make();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      noticeId: "오늘것", title: "적다 만 공지", version: 2, existing: true,
    });
    expect(all()).toHaveLength(1);
  });

  it("지난 공지가 있으면 오늘 것을 새로 만든다", async () => {
    installNotion();
    seed({ id: "지난것", slug: "whiffkorea", date: "2026-07-31", title: "7월 공지" });

    const res = await make();

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ date: todayKst(), title: "" });
    expect(all()).toHaveLength(2);
  });

  it("다른 기업의 오늘 공지는 내 것으로 세지 않는다", async () => {
    installNotion();
    seed({ id: "남의것", slug: "zeroback", date: todayKst(), title: "남의 공지" });

    const res = await make();

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ slug: "whiffkorea", title: "" });
    expect(all()).toHaveLength(2);
  });

  it("재빌드를 부르지 않는다 — 빈 공지가 나가면 공지가 통째로 사라진다", async () => {
    const { calls } = installNotion();

    await make();

    expect(dispatches(calls)).toHaveLength(0);
  });

  it("노션에는 아무것도 쓰지 않는다 — 공지의 원본은 이제 저장소다", async () => {
    const { calls } = installNotion();

    await make();

    expect(writes(calls)).toHaveLength(0);
  });
});

describe("만들 수 없는 것", () => {
  it("모르는 슬러그면 404 다", async () => {
    installNotion({ share: { results: [] } });

    const res = await make({ slug: "없는기업" });

    expect(res.status).toBe(404);
    expect(all()).toHaveLength(0);
  });

  it("slug 가 없으면 422 다", async () => {
    installNotion();

    const res = await make({});

    expect(res.status).toBe(422);
    expect(all()).toHaveLength(0);
  });

  it("비밀번호가 없으면 401 이고, 노션에 묻지도 않는다", async () => {
    const { calls } = installNotion();

    const res = await make({ slug: "whiffkorea" }, { password: null });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(all()).toHaveLength(0);
  });

  it("저장소가 붙어 있지 않으면 503 이다", async () => {
    installNotion();

    const res = await worker.fetch(new Request("https://relay.test/notice/doc", {
      method: "POST",
      headers: { authorization: `Bearer ${b64(good)}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "whiffkorea" }),
    }), ENV);

    expect(res.status).toBe(503);
  });
});
