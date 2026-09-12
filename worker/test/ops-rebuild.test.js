import { describe, expect, it } from "vitest";

import worker from "../src/index.js";
import { dispatches, ENV, installNotion } from "./helpers.js";


function call(token, body = { slug: "whiffkorea" }, env = ENV) {
  const headers = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return worker.fetch(new Request("https://relay.test/ops/rebuild", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), env);
}


describe("POST /ops/rebuild", () => {
  it("자동화 전용 토큰이 없으면 거절한다", async () => {
    const { calls } = installNotion();

    const res = await call(null);

    expect(res.status).toBe(401);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("담당자 비밀번호와 빌드 토큰을 재사용할 수 없다", async () => {
    const { calls } = installNotion();

    expect((await call(ENV.EDITOR_PASSWORD)).status).toBe(401);
    expect((await call("build-token")).status).toBe(401);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("아는 기업만 한 번 재빌드 요청한다", async () => {
    const { calls } = installNotion();

    const res = await call(ENV.AUTOMATION_TOKEN);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ slug: "whiffkorea", rebuild: "sent" });
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("모르는 기업은 재빌드하지 않는다", async () => {
    const { calls } = installNotion({ share: { results: [] } });

    const res = await call(ENV.AUTOMATION_TOKEN, { slug: "unknown" });

    expect(res.status).toBe(404);
    expect(dispatches(calls)).toHaveLength(0);
  });
});
