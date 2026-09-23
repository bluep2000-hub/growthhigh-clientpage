import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/private-index.js";
import { privateDb } from "./private-db.js";
import { createStaffSession, customerLogin, sessionCookie, setCustomerPassword } from "../src/private-auth.js";
import { createPrivateStore } from "../src/private-store.js";
import { policyCatalog } from "../src/private-recommend.js";

const origin = "https://private.test";
const programs = [
  { file: "review-active.html", title: "검수용 지원사업",
    deadline_iso: "2099-12-31T15:00:00+09:00",
    industries: ["제조업"], summary: "신청 조건과 지원 내용을 비교하는 요약", meta: { "대상": "게임 개발사",
      "지원": "최대 1억 원", "마감": "12.31 15시" } },
  { file: "review-sooner.html", title: "먼저 마감되는 지원사업", deadline_iso: "2099-11-30" },
  { file: "review-closed.html", title: "마감된 사업",
    deadline_iso: "2020-01-01T15:00:00+09:00" },
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

  it("담은결 제조업 분류와 추천 저장은 보울게임즈 선택 목록과 분리된다", async () => {
    await setCustomerPassword(env, "dameungyeol", "test-password");
    const catalog = await call("/recommendations/catalog", "GET", undefined, staff, "dameungyeol");
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).programs[0].industries).toEqual(["제조업"]);
    expect((await call("/recommendations", "PUT", {slug:"dameungyeol",program:"review-active"}, undefined, "dameungyeol")).status).toBe(401);
    expect((await call("/recommendations", "PUT", {slug:"bowlgames",program:"review-active"}, staff, "dameungyeol")).status).toBe(403);
    expect((await call("/recommendations", "PUT", {slug:"dameungyeol",program:"review-active"}, staff, "dameungyeol")).status).toBe(200);
    expect((await (await call("/recommendations/share", "GET", undefined, undefined, "dameungyeol")).json()).items).toHaveLength(1);
    expect((await (await call("/recommendations/share")).json()).items).toHaveLength(0);
    expect((await call("/recommendations", "DELETE", {slug:"dameungyeol",program:"review-active"}, staff, "dameungyeol")).status).toBe(200);
  });

  it("인증 없는 편집과 다른 기업의 변경을 거절하고 저장하지 않는다", async () => {
    expect((await call("/recommendations", "PUT", { slug: "bowlgames", program: "review-active" })).status).toBe(401);
    expect((await call("/recommendations/catalog")).status).toBe(401);
    expect((await call("/recommendations", "PATCH", { slug: "bowlgames",
      program: "review-active", pinned: true })).status).toBe(401);
    expect((await call("/recommendations", "PUT", { slug: "other", program: "review-active" }, staff)).status).toBe(403);
    expect((await call("/recommendations", "PUT", { slug: "bowlgames", program: "review-active" }, staff, "sample")).status).toBe(404);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM recommendation_items").get().n).toBe(0);
  });

  it("담당자 추가·빼기가 고객페이지와 별도 검토서 목록에 즉시 함께 반영된다", async () => {
    const catalog = await (await call("/recommendations/catalog", "GET", undefined, staff)).json();
    expect(catalog.programs[0]).toMatchObject({ summary: "신청 조건과 지원 내용을 비교하는 요약",
      audience: "게임 개발사", deadline: "2099-12-31", expired: false });
    expect(catalog.programs[2]).toMatchObject({ deadline: "2020-01-01", expired: true });
    const input = { slug: "bowlgames", program: "review-active" };
    expect((await call("/recommendations", "PUT", input, staff)).status).toBe(200);
    expect((await call("/recommendations", "PUT", input, staff)).status).toBe(200);
    const share = await call("/recommendations/share");
    expect(share.headers.get("access-control-allow-origin")).toBe("https://curation.growthhigh.co.kr");
    expect((await share.json()).items).toMatchObject([{ slug: "review-active" }]);
    const visible = await (await call("/api/customer", "GET", undefined, customer)).json();
    expect(visible.recommend).toMatchObject([{ slug: "review-active", title: "검수용 지원사업",
      amount: "최대 1억 원", pinned: false }]);
    expect(visible.recommend[0].review_url).toContain("review-active.html");
    expect(visible.recommend).not.toContainEqual({ title: "옛 재생목록 값" });
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM recommendation_items").get().n).toBe(1);
    expect((await call("/recommendations", "DELETE", input, staff)).status).toBe(200);
    expect((await (await call("/recommendations/share")).json()).items).toEqual([]);
    expect((await (await call("/api/customer", "GET", undefined, customer)).json()).recommend).toEqual([]);
  });

  it("선택한 추천만 즐겨찾기로 지정·해제하고 고객페이지·검토서에서 먼저 보인다", async () => {
    const input = program => ({ slug: "bowlgames", program });
    await call("/recommendations", "PUT", input("review-active"), staff);
    await call("/recommendations", "PUT", input("review-sooner"), staff);
    expect((await (await call("/api/customer", "GET", undefined, customer)).json())
      .recommend.map(p => p.slug)).toEqual(["review-sooner", "review-active"]);
    expect((await call("/recommendations", "PATCH",
      { ...input("missing"), pinned: true }, staff)).status).toBe(404);
    expect((await call("/recommendations", "PATCH",
      { ...input("review-active"), pinned: "yes" }, staff)).status).toBe(422);
    expect((await call("/recommendations", "PATCH",
      { ...input("review-active"), pinned: true }, staff)).status).toBe(200);
    expect((await (await call("/recommendations/share")).json()).items)
      .toMatchObject([{ slug: "review-active", pinned: 1 }, { slug: "review-sooner", pinned: 0 }]);
    expect((await (await call("/api/customer", "GET", undefined, customer)).json())
      .recommend.map(p => [p.slug, p.pinned])).toEqual([
        ["review-active", true], ["review-sooner", false],
      ]);
    await call("/recommendations", "PATCH", { ...input("review-active"), pinned: false }, staff);
    expect((await (await call("/api/customer", "GET", undefined, customer)).json())
      .recommend.map(p => p.slug)).toEqual(["review-sooner", "review-active"]);
    await call("/recommendations", "PATCH", { ...input("review-active"), pinned: true }, staff);
    await call("/recommendations", "DELETE", input("review-active"), staff);
    expect((await (await call("/recommendations/share")).json()).items.map(p => p.slug))
      .toEqual(["review-sooner"]);
    await call("/recommendations", "PUT", input("review-active"), staff);
    expect((await (await call("/recommendations/share")).json()).items
      .find(p => p.slug === "review-active").pinned).toBe(0);
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

  it("마감 시각이 포함된 공고는 그 시각이 지나면 추가 대상에서 제외한다", async () => {
    const fetcher = async () => Response.json({ programs: [{ file: "today.html",
      title: "오늘 마감", deadline_iso: "2026-09-30T15:00:00+09:00" }] });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-30T05:59:00Z"));
      expect((await policyCatalog(fetcher))[0]).toMatchObject({ deadline: "2026-09-30",
        expired: false });
      vi.setSystemTime(new Date("2026-09-30T06:00:01Z"));
      expect((await policyCatalog(fetcher))[0].expired).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
