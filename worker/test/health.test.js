import { describe, expect, it } from "vitest";

import worker from "../src/index.js";

/**
 * 창구에 요청을 넣고 응답만 본다. 내부 함수를 직접 부르지 않는다 —
 * 구현을 바꿔도 이 테스트는 깨지지 않아야 한다.
 */
function call(path, init) {
  return worker.fetch(new Request(`https://relay.test${path}`, init), {});
}

describe("GET /health", () => {
  it("살아 있으면 200 을 준다", async () => {
    const res = await call("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});

describe("모르는 경로", () => {
  it("404 를 준다", async () => {
    const res = await call("/nope");

    expect(res.status).toBe(404);
  });

  it("/health 라도 GET 이 아니면 404 를 준다", async () => {
    const res = await call("/health", { method: "POST" });

    expect(res.status).toBe(404);
  });
});
