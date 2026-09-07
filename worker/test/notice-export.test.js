/**
 * 빌드가 공지를 가져가는 창구 — `GET /notice/export`.
 *
 * 빌더는 이제 공지를 노션에서 읽지 않고 저장소에서 받아 봉투에 싣는다.
 *
 * **담당자 공용 비밀번호를 쓰지 않는다.** 읽기만 하는 자리에 쓰기 권한을 두지
 * 않는다 — 빌드 서버는 로컬 PC 이고, 그 `.env` 가 새면 담당자 비밀번호까지
 * 함께 새기 때문이다. 그래서 값도 창구도 서로 넘나들지 못하게 갈라 둔다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/store.js", () => import("./fake-store.js"));

import worker from "../src/index.js";
import { reset, seed } from "./fake-store.js";
import { ENV } from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const BUILD = "build-token-abcd";
const ENV_DB = { ...ENV, DB: {}, BUILD_TOKEN: BUILD };

beforeEach(() => { reset(); });

/** 빌드 토큰은 그대로 싣는다. base64 는 한글 비밀번호 때문에 있는 것이고,
    이 값은 우리가 만드는 ASCII 라 헤더에 그냥 들어간다. */
function exportDoc(slug = "whiffkorea", { token = BUILD, env = ENV_DB } = {}) {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return worker.fetch(new Request(
    `https://relay.test/notice/export?slug=${encodeURIComponent(slug)}`, { headers }), env);
}

function whiff() {
  return seed({
    id: "notice-1", slug: "whiffkorea", date: "2026-07-31", title: "7월 공지", version: 3,
    sections: [{ id: "s1", title: "진행 상황",
                 items: [{ id: "n1", type: "bullet", html: "지난 줄", items: [] }] }],
  });
}

describe("GET /notice/export", () => {
  it("빌드 토큰으로 그 기업의 최신 공지 문서를 준다", async () => {
    whiff();

    const res = await exportDoc();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      noticeId: "notice-1", slug: "whiffkorea", date: "2026-07-31",
      title: "7월 공지", version: 3,
      sections: [{ id: "s1", title: "진행 상황",
                   items: [{ id: "n1", type: "bullet", html: "지난 줄" }] }],
    });
  });

  it("공지가 없으면 404 다 — 빌더는 그때 노션에서 읽는다", async () => {
    const res = await exportDoc();

    expect(res.status).toBe(404);
  });

  it("남의 기업 공지는 그 슬러그로만 나온다", async () => {
    whiff();

    const res = await exportDoc("zeroback");

    expect(res.status).toBe(404);
  });

  it("slug 가 없으면 422 다", async () => {
    const res = await worker.fetch(new Request("https://relay.test/notice/export", {
      headers: { authorization: `Bearer ${BUILD}` },
    }), ENV_DB);

    expect(res.status).toBe(422);
  });
});

describe("빌드 토큰과 담당자 비밀번호는 서로의 창구를 열지 못한다", () => {
  it("담당자 비밀번호로는 내보내기가 열리지 않는다", async () => {
    whiff();

    const res = await exportDoc("whiffkorea", { token: b64(ENV.EDITOR_PASSWORD) });

    expect(res.status).toBe(401);
  });

  it("빌드 토큰으로는 읽기 창구가 열리지 않는다", async () => {
    whiff();

    const res = await worker.fetch(new Request("https://relay.test/notice/doc?slug=whiffkorea", {
      headers: { authorization: `Bearer ${BUILD}` },
    }), ENV_DB);

    expect(res.status).toBe(401);
  });

  it("빌드 토큰으로는 저장이 되지 않는다", async () => {
    whiff();

    const res = await worker.fetch(new Request("https://relay.test/notice/doc", {
      method: "PUT",
      headers: { authorization: `Bearer ${BUILD}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                             title: "남이 쓴 제목", sections: [] }),
    }), ENV_DB);

    expect(res.status).toBe(401);
  });

  it("빌드 토큰을 정해 두지 않았으면 아무 값으로도 열리지 않는다", async () => {
    whiff();

    const res = await exportDoc("whiffkorea", { token: "", env: { ...ENV, DB: {} } });

    expect(res.status).toBe(401);
  });

  it("토큰이 없으면 401 이다", async () => {
    whiff();

    const res = await exportDoc("whiffkorea", { token: null });

    expect(res.status).toBe(401);
  });
});
