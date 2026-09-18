import { ApiError, unauthorized, unprocessable } from "./error.js";

const ITERATIONS = 100000;
const encode = (text) => new TextEncoder().encode(text);
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const randomToken = () => b64(crypto.getRandomValues(new Uint8Array(32)))
  .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
export const tokenHash = async (token) => [...new Uint8Array(
  await crypto.subtle.digest("SHA-256", encode(token)),
)].map((n) => n.toString(16).padStart(2, "0")).join("");
export const setupError = () => new ApiError(503, "auth_not_configured");

function dbOf(env) {
  if (!env.PRIVATE_DB) throw setupError();
  return env.PRIVATE_DB;
}
function requireSlug(slug) {
  if (slug !== "whiffkorea") throw unprocessable("허용되지 않은 기업입니다");
}
function requirePassword(password) {
  if (typeof password !== "string" || !password.length || encode(password).length > 1024)
    throw unprocessable("비밀번호를 입력해 주세요");
}
async function pepperKey(env) {
  if (typeof env.AUTH_PEPPER !== "string" || env.AUTH_PEPPER.length < 43) throw setupError();
  return crypto.subtle.importKey("raw", encode(env.AUTH_PEPPER),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function derive(password, salt) {
  const key = await crypto.subtle.importKey("raw", encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt,
    iterations: ITERATIONS }, key, 256);
}

/** Workers의 PBKDF2 상한에 맞추고 DB 외부 secret의 pepper로 추가 보호한다. */
export async function passwordRecord(env, password) {
  requirePassword(password);
  const key = await pepperKey(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await crypto.subtle.sign("HMAC", key, await derive(password, salt));
  return { password_hash: b64(hash), salt: b64(salt), iterations: ITERATIONS };
}
export async function passwordMatches(env, password, record) {
  requirePassword(password);
  const key = await pepperKey(env);
  if (!record || record.iterations !== ITERATIONS) return false;
  return crypto.subtle.verify("HMAC", key, unb64(record.password_hash),
    await derive(password, unb64(record.salt)));
}

export function cookieToken(request, kind) {
  const name = kind === "customer" ? "__Host-gh_customer" : "__Host-gh_staff";
  const values = (request.headers.get("cookie") || "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function sessionCookie(kind, token = "") {
  const name = kind === "customer" ? "__Host-gh_customer" : "__Host-gh_staff";
  // 브라우저 쿠키의 저장 한도다. 서버 세션에는 임의의 고정 만료시간을 두지 않는다.
  return `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${token ? 34560000 : 0}`;
}
export const nonceCookie = (token = "") =>
  `__Host-gh_nonce=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${token ? 600 : 0}`;
export function readNonce(request) {
  const parts = (request.headers.get("cookie") || "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith("__Host-gh_nonce="));
  const value = parts.length === 1 ? parts[0].slice("__Host-gh_nonce=".length) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export async function limitAuthRequests(request, env, scope) {
  const db = dbOf(env);
  const key = await pepperKey(env);
  const window = Math.floor(Date.now() / 60000);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const signed = await crypto.subtle.sign("HMAC", key, encode(`${scope}:${ip}:${window}`));
  const bucket = b64(signed);
  const result = await db.prepare(`INSERT INTO auth_request_buckets (bucket_key, window, count)
    VALUES (?, ?, 1) ON CONFLICT (bucket_key) DO UPDATE SET count = count + 1 RETURNING count`)
    .bind(bucket, window).first();
  await db.prepare("DELETE FROM auth_request_buckets WHERE window < ?").bind(window - 1).run();
  if (result.count > 20) throw new ApiError(429, "too_many_requests");
}

export async function customerLogin(request, env, { slug, password }) {
  requireSlug(slug);
  requirePassword(password);
  await limitAuthRequests(request, env, "customer_login");
  const db = dbOf(env);
  const record = await db.prepare("SELECT * FROM customer_credentials WHERE slug = ?").bind(slug).first();
  if (!await passwordMatches(env, password, record)) throw unauthorized();
  const token = randomToken();
  const previous = cookieToken(request, "customer");
  // 비밀번호 확인 도중 변경돼도 이전 버전 세션을 만들지 않는다.
  const statements = [db.prepare(`INSERT INTO customer_sessions
    (token_hash, slug, credential_version, created_at)
    SELECT ?, slug, version, ? FROM customer_credentials WHERE slug = ? AND version = ?`)
    .bind(await tokenHash(token), Date.now(), slug, record.version)];
  if (previous) statements.push(db.prepare("DELETE FROM customer_sessions WHERE token_hash = ?")
    .bind(await tokenHash(previous)));
  await db.batch(statements);
  if (!await customerSession(new Request(request.url, { headers: { cookie: `__Host-gh_customer=${token}` } }), env))
    throw unauthorized();
  return token;
}
export async function customerSession(request, env) {
  const token = cookieToken(request, "customer");
  if (!token) return null;
  return dbOf(env).prepare(`SELECT s.slug FROM customer_sessions s JOIN customer_credentials c
    ON c.slug = s.slug AND c.version = s.credential_version WHERE s.token_hash = ?`)
    .bind(await tokenHash(token)).first();
}
export async function logout(request, env, kind) {
  const token = cookieToken(request, kind);
  if (token) await dbOf(env).prepare(`DELETE FROM ${kind === "customer" ? "customer_sessions" : "staff_sessions"}
    WHERE token_hash = ?`).bind(await tokenHash(token)).run();
}
/** 내부 관리·이관 전용. HTTP에서는 먼저 Google/Notion 권한을 확인한다. */
export async function setCustomerPassword(env, slug, password) {
  requireSlug(slug);
  const record = await passwordRecord(env, password);
  await dbOf(env).batch([
    dbOf(env).prepare(`INSERT INTO customer_credentials (slug, password_hash, salt, iterations)
      VALUES (?, ?, ?, ?) ON CONFLICT (slug) DO UPDATE SET
      password_hash = excluded.password_hash, salt = excluded.salt,
      iterations = excluded.iterations, version = customer_credentials.version + 1`)
      .bind(slug, record.password_hash, record.salt, record.iterations),
    dbOf(env).prepare("DELETE FROM customer_sessions WHERE slug = ?").bind(slug),
  ]);
}

export async function issueStaffNonce(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.INTERNAL_USERS_DB_ID || !env.NOTION_TOKEN) throw setupError();
  const nonce = randomToken();
  const db = dbOf(env);
  await db.batch([
    db.prepare("DELETE FROM staff_login_nonces WHERE expires_at <= ?").bind(Date.now()),
    db.prepare("INSERT INTO staff_login_nonces (token_hash, expires_at) VALUES (?, ?)")
      .bind(await tokenHash(nonce), Date.now() + 600000),
  ]);
  return nonce;
}
export async function consumeStaffNonce(request, env) {
  const nonce = readNonce(request);
  if (!nonce) throw unauthorized();
  const row = await dbOf(env).prepare(`DELETE FROM staff_login_nonces
    WHERE token_hash = ? AND expires_at > ? RETURNING token_hash`)
    .bind(await tokenHash(nonce), Date.now()).first();
  if (!row) throw unauthorized();
  return nonce;
}
export async function createStaffSession(env, identity) {
  const token = randomToken();
  const db = dbOf(env);
  await db.batch([
    db.prepare("DELETE FROM staff_sessions WHERE provider_expires_at <= ?").bind(Date.now()),
    db.prepare(`INSERT INTO staff_sessions (token_hash, google_sub, email, provider_expires_at)
      VALUES (?, ?, ?, ?)`)
      .bind(await tokenHash(token), identity.sub, identity.email, identity.exp * 1000),
  ]);
  return token;
}
export async function staffSession(request, env) {
  const token = cookieToken(request, "staff");
  if (!token) throw unauthorized();
  const row = await dbOf(env).prepare(`SELECT google_sub, email FROM staff_sessions
    WHERE token_hash = ? AND provider_expires_at > ?`)
    .bind(await tokenHash(token), Date.now()).first();
  if (!row) throw unauthorized();
  return row;
}
