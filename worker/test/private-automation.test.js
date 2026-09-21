import { describe, expect, it } from "vitest";

import worker from "../src/private-index.js";

function environment(known = new Set(["bowlgames"])) {
  const jobs = [];
  return { jobs, env: {
    AUTOMATION_TOKEN: "secret-automation-token",
    PRIVATE_DB: {
      prepare(sql) {
        return { bind(...values) { return {
          async first() {
            return sql.includes("customer_credentials") && known.has(values[0])
              ? { slug: values[0] } : null;
          },
          async run() { jobs.push({ sql, values }); },
        }; } };
      },
    },
  } };
}

function request(slug, token = "secret-automation-token") {
  return new Request("https://private.test/ops/rebuild", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ slug }),
  });
}

describe("비공개 고객페이지 자동화 갱신 요청", () => {
  it("자동화 토큰으로 등록 기업의 갱신을 대기열에 넣는다", async () => {
    const { env, jobs } = environment();
    const response = await worker.fetch(request("bowlgames"), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ slug: "bowlgames", rebuild: "sent" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sql).toContain("private_rebuild_job");
    expect(jobs[0].values[0]).toBe("bowlgames");
  });

  it("토큰 오류와 등록되지 않은 기업은 갱신하지 않는다", async () => {
    const { env, jobs } = environment();
    expect((await worker.fetch(request("bowlgames", "wrong"), env)).status).toBe(401);
    expect((await worker.fetch(request("unknown"), env)).status).toBe(404);
    expect(jobs).toHaveLength(0);
  });
});
