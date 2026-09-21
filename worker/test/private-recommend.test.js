import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/private-index.js";
import { privateDb } from "./private-db.js";
import { createStaffSession, customerLogin, sessionCookie, setCustomerPassword } from "../src/private-auth.js";
import { createPrivateStore } from "../src/private-store.js";

const origin = "https://private.test";
const programs = [
  { file: "review-active.html", title: "검수용 지원사업", deadline_iso: "2099-12-31",
    meta: { "지원": "최대 1억 원" } },
  { file: "review-closed.html", title: "마감된 사업", deadline_iso: "2020-01-01" },
];
const payload = { generated_at: "2026-09-21T12:00:00+09:00",
  company: { name: "보울게임즈" }, notice: null, perf: null, progress: [],
  recommend: [{ title: "옛 재생목록 값" }], talks: [], actions: [], actions_done: 0,
  events: [], kpi: {} };

describe("보울게임즈 추천 지원사업 실시간 관리", () => {
  let fixture, env, staff, customer, catalogAvailable;
  const call = (path, method = "GET", input, cookie, slug = "bowlgames") =>
    worker.fetch(new Request(`${origin}/${slug}${path}`, { method,
      headers: { origin, ...(cookie ? { cookie } : {}),
        ...(input ? { "content-type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    }), env);
  beforeEach(async () => {
    fixture = privateDb();
    env = { PRIVATE_DB: fixture.db, AUTH_PEPPER: "test-only-".repeat(8),
      APP_ORIGIN: origin, INTERNAL_USERS_DB_ID: "11111111-1111-1111-1111-111111111111",
      NOTION_TOKEN: "test-only" };
    await setCustomerPassword(env, "bowlgames", "test-password");
    await createPrivateStore(env).save({ slug: "bowlgames", buildKey: "first",
      startedAt: 100, payload });
    staff = sessionCookie("staff", await createStaffSession(env, { sub: "pm",
      email: "pm@example.com", exp: Math.floor(Date.now() / 1000) + 3600 })).split(";")[0];
    customer = sessionCookie("customer", await customerLogin(new Request(origin), env,
      { slug: "bowlgames", password: "test-password" })).split(";")[0];
    catalogAvailable = true;
    vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("notion.com")
      ? Response.json({ results: [{ properties: { "역할": { select: { name: "PM" } } } }] })
      : catalogAvailable ? Response.json({ programs }) : new Response("", { status: 503 })));
  });
  afterEach(() => { fixture.sqlite.close(); vi.unstubAllGlobals(); });

  it("인증 없는 편집과 다른 기업의 변경을 거절하고 저장하지 않는다", async () => {
    expect((await call("/recommendations", "PUT", { slug: "bowlgames", program: "review-active" })).status).toBe(401);
    expect((await call("/recommendations/catalog")).status).toBe(401);
    expect((await call("/recommendations", "PUT", { slug: "other", program: "review-active" }, staff)).status).toBe(403);
    expect((await call("/recommendations", "PUT", { slug: "bowlgames", program: "review-active" }, staff, "sample")).status).toBe(404);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM recommendation_items").get().n).toBe(0);
  });

  it("담당자 추가·빼기가 고객페이지와 별도 검토서 목록에 즉시 함께 반영된다", async () => {
    const input = { slug: "bowlgames", program: "review-active" };
    expect((await call("/recommendations", "PUT", input, staff)).status).toBe(200);
    expect((await call("/recommendations", "PUT", input, staff)).status).toBe(200);
    const share = await call("/recommendations/share");
    expect(share.headers.get("access-control-allow-origin")).toBe("https://curation.growthhigh.co.kr");
    expect((await share.json()).items).toMatchObject([{ slug: "review-active" }]);
    const visible = await (await call("/api/customer", "GET", undefined, customer)).json();
    expect(visible.recommend).toMatchObject([{ slug: "review-active", title: "검수용 지원사업",
      amount: "최대 1억 원" }]);
    expect(visible.recommend[0].review_url).toContain("review-active.html");
    expect(visible.recommend).not.toContainEqual({ title: "옛 재생목록 값" });
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM recommendation_items").get().n).toBe(1);
    expect((await call("/recommendations", "DELETE", input, staff)).status).toBe(200);
    expect((await (await call("/recommendations/share")).json()).items).toEqual([]);
    expect((await (await call("/api/customer", "GET", undefined, customer)).json()).recommend).toEqual([]);
  });

  it("존재하지 않거나 마감된 공고를 추가하지 않고 원천 장애를 빈 목록으로 숨기지 않는다", async () => {
    for (const program of ["missing", "review-closed"])
      expect((await call("/recommendations", "PUT", { slug: "bowlgames", program }, staff)).status).toBe(422);
    await call("/recommendations", "PUT", { slug: "bowlgames", program: "review-active" }, staff);
    catalogAvailable = false;
    const visible = await (await call("/api/customer", "GET", undefined, customer)).json();
    expect(visible.recommend_unavailable).toBe(true);
    expect(visible.recommend).toEqual([]);
    expect((await call("/recommendations", "PUT", { slug: "bowlgames", program: "missing" }, staff)).status).toBe(503);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM recommendation_items").get().n).toBe(1);
  });
});
