import { ApiError, unprocessable } from "./error.js";
import {
  consumeStaffNonce, createStaffSession, customerLogin, customerSession, issueStaffNonce,
  limitAuthRequests, logout, nonceCookie, sessionCookie, setCustomerPassword, setupError,
} from "./private-auth.js";
import { requireStaff, resolveStaff, verifyGoogleToken } from "./private-staff.js";
import { loginPage } from "./private-ui.js";

// 인증 API만 연결됐다. 고객 데이터·기존 관리 API 연결은 다음 개발 작업이다.
function json(body, status = 200, cookie) {
  return Response.json(body, { status, headers: {
    "cache-control": "no-store", "x-content-type-options": "nosniff",
    ...(cookie ? { "set-cookie": cookie } : {}),
    ...(status === 429 ? { "retry-after": "60" } : {}),
  } });
}
function sameOrigin(request, env) {
  const origin = new URL(request.url).origin;
  if (!env.APP_ORIGIN || env.APP_ORIGIN !== origin) throw setupError();
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError(403, "invalid_origin");
}
async function body(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw unprocessable("JSON 요청이 필요합니다");
  // 스트림 단계에서 크기를 제한해 Content-Length가 없는 요청도 보호한다.
  const reader = request.body?.getReader();
  if (!reader) throw unprocessable();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) { await reader.cancel(); throw new ApiError(413, "request_too_large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* 아래에서 거절 */ }
  throw unprocessable();
}
export default {
  async fetch(request, env = {}) {
    if (request.method === "GET" && new URL(request.url).pathname === "/whiffkorea/")
      return loginPage(request);
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return json({ status: "setup", customerReady: false });
    }
    const path = new URL(request.url).pathname;
    const routes = ["/auth/customer/login", "/auth/customer/session", "/auth/customer/logout",
      "/auth/staff/challenge", "/auth/staff/login", "/auth/staff/session", "/auth/staff/logout",
      "/auth/customer/password"];
    if (!routes.includes(path)) return json({ error: "not_found" }, 404);
    try {
      const get = path.endsWith("/session");
      if (request.method !== (get ? "GET" : "POST")) return json({ error: "method_not_allowed" }, 405);
      if (!get) sameOrigin(request, env);
      if (path === "/auth/customer/session") {
        const session = await customerSession(request, env);
        return json({ authenticated: !!session, ...(session ? { slug: session.slug } : {}) });
      }
      if (path === "/auth/customer/login") {
        const token = await customerLogin(request, env, await body(request));
        return json({ authenticated: true, slug: "whiffkorea" }, 200, sessionCookie("customer", token));
      }
      if (path.endsWith("/logout")) {
        const kind = path.includes("/customer/") ? "customer" : "staff";
        await logout(request, env, kind);
        return json({ authenticated: false }, 200, sessionCookie(kind));
      }
      if (path === "/auth/staff/challenge") {
        await limitAuthRequests(request, env, "staff_challenge");
        const nonce = await issueStaffNonce(env);
        return json({ nonce, clientId: env.GOOGLE_CLIENT_ID }, 200, nonceCookie(nonce));
      }
      if (path === "/auth/staff/login") {
        await limitAuthRequests(request, env, "staff_login");
        const input = await body(request);
        const nonce = await consumeStaffNonce(request, env);
        const identity = await verifyGoogleToken(input.credential, env.GOOGLE_CLIENT_ID, nonce);
        const scope = await resolveStaff(env, identity.email);
        const token = await createStaffSession(env, identity);
        // 기존 PM 세션도 지워 로그인 시 토큰을 교체한다.
        await logout(request, env, "staff");
        const response = json({ authenticated: true, ...scope }, 200, sessionCookie("staff", token));
        response.headers.append("set-cookie", nonceCookie());
        return response;
      }
      const scope = await requireStaff(request, env);
      if (path === "/auth/staff/session") return json({ authenticated: true, ...scope });
      const input = await body(request);
      await setCustomerPassword(env, input.slug, input.password);
      return json({ changed: true, slug: scope.slug });
    } catch (error) {
      // upstream 설명·SQL·비밀번호·토큰은 응답이나 로그에 남기지 않는다.
      return json({ error: error instanceof ApiError ? error.code : "internal_error" },
        error instanceof ApiError ? error.status : 500);
    }
  },
};
