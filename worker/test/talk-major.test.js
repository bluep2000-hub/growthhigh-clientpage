/**
 * `PUT /talk/major` — 담당자가 소통 내역을 주요로 지정하거나 해제한다.
 */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import {
  dispatches, ENV, installNotion, OTHER_TALK_PAGE, TALK_DB, TALK_PAGE, talk, writes,
} from "./helpers.js";

const good = Buffer.from(ENV.EDITOR_PASSWORD, "utf8").toString("base64");
const keyFor = (id) => createHash("sha256").update(id, "utf8").digest("hex").slice(0, 24);

function call(body, password = good, env = ENV) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${password}`;
  return worker.fetch(new Request("https://relay.test/talk/major", {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  }), env);
}

const request = (major, extra = {}) => ({
  slug: "whiffkorea",
  talkKey: keyFor(TALK_PAGE),
  major,
  ...extra,
});

describe("PUT /talk/major", () => {
  beforeEach(() => installNotion());

  it("담당자 인증이 없으면 거절한다", async () => {
    const { calls } = installNotion();
    const res = await call(request(true), null);

    expect(res.status).toBe(401);
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("24자리 해시 키와 불리언 값만 받는다", async () => {
    installNotion();
    const badKey = await call(request(true, { talkKey: TALK_PAGE }));
    const badMajor = await call(request("true"));

    expect(badKey.status).toBe(422);
    expect(badMajor.status).toBe(422);
  });

  it("모르는 기업은 거절한다", async () => {
    installNotion({ share: { results: [] } });
    const res = await call(request(true));

    expect(res.status).toBe(404);
  });

  it("그 기업 목록에 없는 키는 거절한다", async () => {
    const { calls } = installNotion({ talks: { results: [] } });
    const res = await call(request(true));

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("조회 결과의 고객사 릴레이션을 다시 확인한다", async () => {
    const outsider = talk(OTHER_TALK_PAGE, false, "other-client");
    const { calls } = installNotion({ talks: { results: [outsider] } });
    const res = await call(request(true, { talkKey: keyFor(OTHER_TALK_PAGE) }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_mine" });
    expect(writes(calls)).toHaveLength(0);
  });

  it("주요로 지정하고 재빌드를 한 번만 요청한다", async () => {
    const { calls } = installNotion();
    const res = await call(request(true));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      talkKey: keyFor(TALK_PAGE), major: true, rebuild: "sent",
    });
    expect(writes(calls)).toEqual([expect.objectContaining({
      method: "PATCH",
      path: `/pages/${TALK_PAGE}`,
      body: { properties: { "주요": { checkbox: true } } },
    })]);
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("주요 지정을 해제한다", async () => {
    const { calls } = installNotion({ talks: { results: [talk(TALK_PAGE, true)] } });
    const res = await call(request(false));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ major: false, rebuild: "sent" });
    expect(writes(calls)[0].body).toEqual({ properties: { "주요": { checkbox: false } } });
  });

  it("이미 같은 값이면 쓰거나 재빌드하지 않는다", async () => {
    const { calls } = installNotion({ talks: { results: [talk(TALK_PAGE, true)] } });
    const res = await call(request(true));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ major: true, rebuild: "skipped" });
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("같은 요청을 반복해도 실제 변경과 재빌드는 한 번뿐이다", async () => {
    const { calls } = installNotion();
    const first = await call(request(true));
    const second = await call(request(true));

    expect(first.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ rebuild: "skipped" });
    expect(writes(calls)).toHaveLength(1);
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("재빌드 요청 실패를 저장 성공과 구분해 알려 준다", async () => {
    const { calls } = installNotion({ dispatchFails: true });
    const res = await call(request(true));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ major: true, rebuild: "failed" });
    expect(writes(calls)).toHaveLength(1);
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("노션 조회 실패 때 재빌드하지 않는다", async () => {
    const { calls } = installNotion({
      fail: (method, path) => method === "POST" && path === `/databases/${TALK_DB}/query`
        ? new Response(JSON.stringify({ message: "rate limited" }), { status: 429 })
        : null,
    });
    const res = await call(request(true));

    expect(res.status).toBe(502);
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });
});
