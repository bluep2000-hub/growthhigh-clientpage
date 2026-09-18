import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { privateDb } from "./private-db.js";
import worker from "../src/private-index.js";

const signing = vi.hoisted(() => ({ publicKey: null }));
vi.mock("jose", async (original) => ({
  ...await original(),
  // 외부 Google 공개키 조회만 가짜 키로 대체한다. 서명·claim 검사는 실제 jose다.
  createRemoteJWKSet: () => async () => signing.publicKey,
}));

describe("PM 로그인 새 연결", () => {
  let sqlite;
  let env;
  let privateKey;
  let registered;
  const origin = "https://private.test";
  const post = (path, body, cookie) => worker.fetch(new Request(origin + path, {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }), env);
  const cookieFrom = (response) => response.headers.get("set-cookie").split(";")[0];
  beforeEach(async () => {
    const db = privateDb();
    sqlite = db.sqlite;
    env = { PRIVATE_DB: db.db, AUTH_PEPPER: "test-only-".repeat(8), APP_ORIGIN: origin,
      GOOGLE_CLIENT_ID: "test-client", NOTION_TOKEN: "test-token",
      INTERNAL_USERS_DB_ID: "11111111-1111-1111-1111-111111111111" };
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    signing.publicKey = pair.publicKey;
    registered = true;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: registered
      ? [{ properties: { "역할": { select: { name: "대표" } } } }] : [] })));
  });
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });
  async function proof(nonce) {
    return new SignJWT({ sub: "fixture-google-sub", email: "owner@example.com", email_verified: true, nonce })
      .setProtectedHeader({ alg: "RS256" }).setIssuer("https://accounts.google.com")
      .setAudience(env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime("1h").sign(privateKey);
  }
  it("challenge → 실제 서명 검증 → Notion 등록 확인 → PM 세션 발급까지 연결된다", async () => {
    const challenge = await post("/auth/staff/challenge", {});
    const { nonce } = await challenge.json();
    const nonceCookie = cookieFrom(challenge);
    const credential = await proof(nonce);
    const result = await post("/auth/staff/login", { credential }, nonceCookie);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ authenticated: true, role: "대표", slug: "whiffkorea" });
    const token = cookieFrom(result).split("=")[1];
    const row = sqlite.prepare("SELECT * FROM staff_sessions").get();
    expect(row.google_sub).toBe("fixture-google-sub");
    expect(row.token_hash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(credential);
    expect((await post("/auth/staff/login", { credential }, nonceCookie)).status).toBe(401);
    expect(sqlite.prepare("SELECT count(*) AS n FROM staff_sessions").get().n).toBe(1);
  });
  it("서명이 유효해도 Notion 미등록 계정에는 PM 세션을 발급하지 않는다", async () => {
    registered = false;
    const challenge = await post("/auth/staff/challenge", {});
    const { nonce } = await challenge.json();
    const result = await post("/auth/staff/login", { credential: await proof(nonce) }, cookieFrom(challenge));
    expect(result.status).toBe(403);
    expect(sqlite.prepare("SELECT count(*) AS n FROM staff_sessions").get().n).toBe(0);
  });
});
