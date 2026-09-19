import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/private-index.js";
import { privateDb } from "./private-db.js";
import {
  consumeStaffNonce, createStaffSession, customerLogin, customerSession, issueStaffNonce,
  passwordMatches, passwordRecord, setCustomerPassword, tokenHash,
} from "../src/private-auth.js";
import { requireStaff, resolveStaff } from "../src/private-staff.js";

const ORIGIN = "https://private.test";
const PASSWORD = "검수용-비밀번호🔒";
const CLIENT_ID = "unit-test.apps.googleusercontent.com";
const USERS_ID = "11111111-1111-1111-1111-111111111111";
const SHARE_ID = "21e815d7-12b9-80dc-8310-d038abd8a502";
const CLIENT_PAGE = "22222222-2222-2222-2222-222222222222";

describe("고객·PM 서버 인증 경계", () => {
  let sqlite;
  let env;
  const request = (path, input, cookie, origin = ORIGIN) => new Request(`${ORIGIN}/whiffkorea${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", "cf-connecting-ip": "192.0.2.1",
      ...(cookie ? { cookie } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const call = (path, input, cookie, origin) => worker.fetch(request(path, input, cookie, origin), env);
  const cookieFrom = (response) => response.headers.get("set-cookie").split(";")[0];
  const login = () => call("/auth/customer/login", { slug: "whiffkorea", password: PASSWORD });
  function roles(role = "PM", assigned = true) {
    const mock = vi.fn(async (url) => {
      const body = url.endsWith(`/databases/${SHARE_ID}/query`)
        ? { results: [{ id: CLIENT_PAGE }] }
        : { results: [{ properties: {
          "역할": { select: { name: role } },
          "담당 기업": { relation: assigned ? [{ id: CLIENT_PAGE }] : [] },
        } }] };
      return Response.json(body);
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  beforeEach(async () => {
    const fixture = privateDb();
    sqlite = fixture.sqlite;
    env = { PRIVATE_DB: fixture.db, AUTH_PEPPER: "test-only-".repeat(8), APP_ORIGIN: ORIGIN,
      GOOGLE_CLIENT_ID: CLIENT_ID, INTERNAL_USERS_DB_ID: USERS_ID, NOTION_TOKEN: "test-only" };
    await setCustomerPassword(env, "whiffkorea", PASSWORD);
  });
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("비밀번호는 서로 다른 salt와 DB 밖 pepper로 보호하며 원문을 저장하지 않는다", async () => {
    const first = await passwordRecord(env, PASSWORD);
    const second = await passwordRecord(env, PASSWORD);
    expect(first.password_hash).not.toBe(second.password_hash);
    expect(await passwordMatches(env, PASSWORD, first)).toBe(true);
    expect(await passwordMatches({ ...env, AUTH_PEPPER: "other-pepper-".repeat(8) }, PASSWORD, first)).toBe(false);
    const row = sqlite.prepare("SELECT * FROM customer_credentials").get();
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(row.iterations).toBe(100000);
  });

  it("잘못된 비밀번호·기업·설정과 교차 출처 요청은 세션을 만들지 않는다", async () => {
    expect((await call("/auth/customer/login", { slug: "whiffkorea", password: "wrong" })).status).toBe(401);
    expect((await call("/auth/customer/login", { slug: "sample", password: PASSWORD })).status).toBe(422);
    expect((await call("/auth/customer/login", { slug: "whiffkorea", password: PASSWORD }, undefined, "https://evil.test")).status).toBe(403);
    const missing = await worker.fetch(request("/auth/customer/login", { slug: "whiffkorea", password: PASSWORD }), { ...env, AUTH_PEPPER: "" });
    expect(missing.status).toBe(503);
    expect(sqlite.prepare("SELECT count(*) AS n FROM customer_sessions").get().n).toBe(0);
  });

  it("고객 세션은 보호 쿠키를 사용하고 DB에는 토큰의 hash만 보관한다", async () => {
    const result = await login();
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Strict");
    expect(result.headers.get("set-cookie")).not.toContain("Domain=");
    const cookie = cookieFrom(result);
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM customer_sessions").get())).not.toContain(cookie.split("=")[1]);
    expect(await (await call("/auth/customer/session", undefined, cookie)).json())
      .toEqual({ authenticated: true, slug: "whiffkorea" });
    const current = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(current + 730 * 86400000);
    expect(await customerSession(request("/auth/customer/session", undefined, cookie), env)).toMatchObject({ slug: "whiffkorea" });
    vi.restoreAllMocks();
  });

  it("고객 로그아웃은 해당 기기 세션만 종료하고 비밀번호 변경은 모든 기기를 종료한다", async () => {
    const a = cookieFrom(await login());
    const b = cookieFrom(await login());
    await call("/auth/customer/logout", {}, a);
    expect((await (await call("/auth/customer/session", undefined, a)).json()).authenticated).toBe(false);
    expect((await (await call("/auth/customer/session", undefined, b)).json()).authenticated).toBe(true);
    await setCustomerPassword(env, "whiffkorea", "새-검수-비밀번호");
    expect((await (await call("/auth/customer/session", undefined, b)).json()).authenticated).toBe(false);
    expect((await login()).status).toBe(401);
  });

  it("비밀번호 확인 도중 변경되면 이전 버전 고객 세션을 발급하지 않는다", async () => {
    const original = env.PRIVATE_DB.batch;
    env.PRIVATE_DB.batch = async (statements) => {
      sqlite.exec("UPDATE customer_credentials SET version = version + 1");
      return original(statements);
    };
    await expect(customerLogin(request("/auth/customer/login", {}), env, { slug: "whiffkorea", password: PASSWORD }))
      .rejects.toMatchObject({ status: 401 });
  });

  it("고객·담당자 공용 인증·자동화 토큰은 PM 작업을 허용하지 않는다", async () => {
    const cookie = cookieFrom(await login());
    const mock = roles();
    for (const headers of [{ cookie }, { authorization: "Bearer old-editor" }, { authorization: "Bearer automation" }]) {
      const req = request("/auth/customer/password", { slug: "whiffkorea", password: "new" });
      for (const [key, value] of Object.entries(headers)) req.headers.set(key, value);
      expect((await worker.fetch(req, env)).status).toBe(401);
    }
    expect(mock).not.toHaveBeenCalled();
    expect(await passwordMatches(env, PASSWORD, sqlite.prepare("SELECT * FROM customer_credentials").get())).toBe(true);
  });

  it("Google 증명이 없는 요청은 PM 세션을 만들지 않고 nonce는 일회용이다", async () => {
    const challenge = await call("/auth/staff/challenge", {});
    const cookie = cookieFrom(challenge);
    const noCredential = await call("/auth/staff/login", {}, cookie);
    expect(noCredential.status).toBe(401);
    expect(sqlite.prepare("SELECT count(*) AS n FROM staff_sessions").get().n).toBe(0);
    await expect(consumeStaffNonce(request("/auth/staff/login", {}, cookie), env)).rejects.toMatchObject({ status: 401 });
    await expect(issueStaffNonce({ ...env, GOOGLE_CLIENT_ID: "" })).rejects.toMatchObject({ status: 503 });
  });

  it("로그인 challenge 만료·nonce 쿠키 누락·재사용을 거절한다", async () => {
    const nonce = await issueStaffNonce(env);
    const cookie = `__Host-gh_nonce=${nonce}`;
    await expect(consumeStaffNonce(request("/auth/staff/login", {}, undefined), env)).rejects.toMatchObject({ status: 401 });
    sqlite.exec("UPDATE staff_login_nonces SET expires_at = 0");
    await expect(consumeStaffNonce(request("/auth/staff/login", {}, cookie), env)).rejects.toMatchObject({ status: 401 });
  });

  it("과도한 요청만 잠시 제한하며 기업 비밀번호나 계정을 잠그지 않는다", async () => {
    const window = Math.floor(Date.now() / 60000);
    vi.spyOn(Date, "now").mockReturnValue(window * 60000 + 1000);
    for (let n = 0; n < 20; n += 1)
      expect((await call("/auth/customer/login", { slug: "whiffkorea", password: "wrong" })).status).toBe(401);
    const throttled = await login();
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("60");
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM auth_request_buckets").all())).not.toContain("192.0.2.1");
    vi.spyOn(Date, "now").mockReturnValue((window + 1) * 60000 + 1000);
    expect((await login()).status).toBe(200);
    vi.restoreAllMocks();
  });

  it("PM 담당 범위·등록 제거를 매 요청에서 확인하고 Notion 오류 때는 쓰기를 막는다", async () => {
    const token = await createStaffSession(env, { sub: "google-test-sub", email: "pm@example.com", exp: Math.floor(Date.now() / 1000) + 3600 });
    const cookie = `__Host-gh_staff=${token}`;
    roles("PM", true);
    expect(await requireStaff(request("/auth/staff/session", undefined, cookie), env)).toEqual({ role: "PM", slug: "whiffkorea" });
    roles("PM", false);
    await expect(requireStaff(request("/auth/staff/session", undefined, cookie), env)).rejects.toMatchObject({ status: 403 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [] })));
    await expect(requireStaff(request("/auth/staff/session", undefined, cookie), env)).rejects.toMatchObject({ status: 403 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "private upstream detail" }, { status: 429 })));
    const blocked = await call("/auth/customer/password", { slug: "whiffkorea", password: "new" }, cookie);
    expect(blocked.status).toBe(502);
    expect(await blocked.json()).toEqual({ error: "notion_failed" });
  });

  it("대표는 담당 관계 없이 허용하며 고객 비밀번호 변경은 응답에 원문을 남기지 않는다", async () => {
    roles("대표", false);
    expect(await resolveStaff(env, "owner@example.com")).toEqual({ role: "대표", slug: "whiffkorea" });
    const token = await createStaffSession(env, { sub: "owner-sub", email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 3600 });
    const oldCustomer = cookieFrom(await login());
    const result = await call("/auth/customer/password", { slug: "whiffkorea", password: "new-secret" }, `__Host-gh_staff=${token}`);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ changed: true, slug: "whiffkorea" });
    expect((await (await call("/auth/customer/session", undefined, oldCustomer)).json()).authenticated).toBe(false);
    const removed = await call("/auth/staff/logout", {}, `__Host-gh_staff=${token}`);
    expect(removed.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call("/auth/staff/session", undefined, `__Host-gh_staff=${token}`)).status).toBe(401);
  });

  it("Google가 발급한 증명의 만료 후에는 다시 Google 인증을 요구한다", async () => {
    const token = await createStaffSession(env, { sub: "expired", email: "pm@example.com", exp: Math.floor(Date.now() / 1000) - 1 });
    expect((await call("/auth/staff/session", undefined, `__Host-gh_staff=${token}`)).status).toBe(401);
  });

  it("공개 봉투·관리 경로를 거절하고 정상 데이터가 없으면 준비 상태만 알린다", async () => {
    const cookie = cookieFrom(await login());
    expect((await call("/c/whiffkorea.enc", undefined, cookie)).status).toBe(404);
    for (const path of ["/room/pin", "/notice/doc"])
      expect((await call(path, undefined, cookie)).status).toBe(401);
    expect((await call('/api/customer',undefined,cookie)).status).toBe(503);
    expect((await call("/auth/customer/login")).status).toBe(405);
    const bad = new Request(`${ORIGIN}/whiffkorea/auth/customer/login`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "x".repeat(17000) });
    expect((await worker.fetch(bad, env)).status).toBe(413);
    const result = await call("/auth/customer/login", { slug: "whiffkorea", password: "wrong" });
    expect(await result.json()).toEqual({ error: "unauthorized" });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect((await tokenHash("test"))).toHaveLength(64);
  });
});
