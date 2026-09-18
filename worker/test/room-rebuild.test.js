import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { dispatches, ENV, installNotion, writes } from "./helpers.js";

const editor = Buffer.from(ENV.EDITOR_PASSWORD, "utf8").toString("base64");
function call(body = { slug: "whiffkorea" }, token = editor, env = ENV) {
  const headers = { "content-type": "application/json", origin: "https://client.growthhigh.co.kr" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return worker.fetch(new Request("https://relay.test/room/rebuild", {
    method: "POST", headers, body: JSON.stringify(body),
  }), env);
}

describe("POST /room/rebuild", () => {
  it("담당자 인증만 허용하고 인증 실패에서는 외부 호출을 하지 않는다", async () => {
    const { calls } = installNotion();
    for (const token of [null, "wrong", ENV.AUTOMATION_TOKEN, "build-token"])
      expect((await call(undefined, token)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("슬러그가 없거나 이전 미검증 기업이면 외부 호출을 하지 않는다", async () => {
    const { calls } = installNotion();
    for (const body of [{}, { slug: "" }, { slug: "studiolb" }, { slug: "zeroback" }])
      expect((await call(body)).status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("등록된 위프코리아만 한 번 요청하며 Notion을 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://client.growthhigh.co.kr");
    await expect(res.json()).resolves.toEqual({ slug: "whiffkorea", rebuild: "sent" });
    expect(dispatches(calls)).toHaveLength(1);
    expect(dispatches(calls)[0].body.client_payload).toEqual({ slug: "whiffkorea" });
    expect(writes(calls)).toHaveLength(0);
  });

  it("Notion 등록이 없으면 요청하지 않는다", async () => {
    const { calls } = installNotion({ share: { results: [] } });
    expect((await call()).status).toBe(404);
    expect(dispatches(calls)).toHaveLength(0);
    expect(writes(calls)).toHaveLength(0);
  });

  it("Notion 조회 제한에서는 빌드를 요청하지 않는다", async () => {
    const { calls } = installNotion({ fail: (_, path) => path.endsWith("/query")
      ? new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }) : null });
    expect((await call()).status).toBe(502);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("GitHub 요청 거절을 sent로 표시하거나 자동 재전송하지 않는다", async () => {
    const { calls } = installNotion({ fail: (_, path) => path.endsWith("/dispatches")
      ? new Response("{}", { status: 403 }) : null });
    await expect((await call()).json()).resolves.toEqual({ slug: "whiffkorea", rebuild: "failed" });
    expect(dispatches(calls)).toHaveLength(1);
    expect(writes(calls)).toHaveLength(0);
  });

  it("배포 연결 설정이 없으면 skipped를 반환한다", async () => {
    const { calls } = installNotion();
    await expect((await call(undefined, editor, { ...ENV, GITHUB_DISPATCH_TOKEN: "" })).json())
      .resolves.toEqual({ slug: "whiffkorea", rebuild: "skipped" });
    expect(dispatches(calls)).toHaveLength(0);
    expect(writes(calls)).toHaveLength(0);
  });
});
