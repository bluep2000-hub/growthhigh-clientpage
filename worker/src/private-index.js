import { ApiError, unprocessable } from "./error.js";
import {
  consumeStaffNonce, createStaffSession, customerLogin, customerSession, issueStaffNonce,
  hasCustomerCredential, limitAuthRequests, logout, nonceCookie, requireSlug, sessionCookie,
  setCustomerPassword, setupError,
  tokenHash,
} from "./private-auth.js";
import { requireStaff, resolveStaff, verifyGoogleToken } from "./private-staff.js";
import { loginPage } from "./private-ui.js";
import { customerPage } from "./private-page.js";
import { createPrivateStore } from "./private-store.js";
import { EDITOR_ROUTES, editorRequest, requestPrivateRebuild } from "./private-editor.js";
import { changeRecommendation, customerRecommendations, policyCatalog, selectedPrograms, setRecommendationPin } from "./private-recommend.js";

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
async function body(request, limit = 16384) {
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
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "request_too_large"); }
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
function scopedPath(url) {
  const slug = url.pathname.split("/")[1];
  try { requireSlug(slug); } catch { return null; }
  const scope = `/${slug}`;
  if (url.pathname === scope) return { slug, path: "/" };
  return url.pathname.startsWith(scope + "/")
    ? { slug, path: url.pathname.slice(scope.length) } : null;
}
function routedRequest(request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  return new Request(url, { method: request.method, headers: request.headers });
}
export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === "/ops/rebuild") {
      try {
        if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
        if (!env.AUTOMATION_TOKEN) throw setupError();
        const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
        if (!given || await tokenHash(given) !== await tokenHash(env.AUTOMATION_TOKEN))
          throw new ApiError(401, "unauthorized");
        const input = await body(request);
        requireSlug(input.slug);
        if (!await hasCustomerCredential(env, input.slug))
          throw new ApiError(404, "not_found");
        return json({ slug: input.slug, rebuild: await requestPrivateRebuild(env, input.slug) });
      } catch (error) {
        return json({ error: error instanceof ApiError ? error.code : "internal_error" },
          error instanceof ApiError ? error.status : 500);
      }
    }
    const route = scopedPath(url);
    if (route === null) return json({ error: "not_found" }, 404);
    const { slug, path } = route;
    if (["bowlgames", "dameungyeol"].includes(slug) && path === "/recommendations/share" && request.method === "GET") {
      try {
        const items = await selectedPrograms(env, slug);
        return Response.json({ items }, { headers: { "cache-control": "no-store",
          "access-control-allow-origin": "https://curation.growthhigh.co.kr",
          "x-content-type-options": "nosniff" } });
      } catch { return json({ error: "recommendations_unavailable" }, 503); }
    }
    if (["bowlgames", "dameungyeol"].includes(slug) && (path === "/recommendations/catalog"
        || path === "/recommendations")) {
      try {
        if (path === "/recommendations/catalog" && request.method !== "GET"
            || path === "/recommendations" && !["PUT", "DELETE", "PATCH"].includes(request.method))
          throw new ApiError(405, "method_not_allowed");
        await requireStaff(request, env, slug);
        if (request.method === "GET") return json({
          selected: await selectedPrograms(env, slug), programs: await policyCatalog(),
        });
        sameOrigin(request, env);
        const input = await body(request);
        if (input.slug !== slug) throw new ApiError(403, "not_assigned");
        const selected = request.method === "PATCH"
          ? await setRecommendationPin(env, slug, input.program, input.pinned)
          : await changeRecommendation(env, slug, input.program, request.method,
            request.method === "PUT" ? await policyCatalog() : []);
        return json({ saved: true, selected });
      } catch (error) {
        return json({ error: error instanceof ApiError ? error.code : "internal_error" },
          error instanceof ApiError ? error.status : 500);
      }
    }
    if (request.method === "GET" && path === "/") {
      try {
        if (!url.searchParams.has("edit") && !await hasCustomerCredential(env, slug))
          return json({ error: "not_found" }, 404);
        return loginPage(request, slug);
      } catch (error) {
        return json({ error: error instanceof ApiError ? error.code : "internal_error" },
          error instanceof ApiError ? error.status : 500);
      }
    }
    if (request.method === "GET" && path === "/health") {
      try {
        const ready = !!await createPrivateStore(env).latest(slug);
        return json({ status: ready ? "ready" : "setup", customerReady: ready });
      } catch {
        return json({ status: "setup", customerReady: false });
      }
    }
    if (EDITOR_ROUTES.has(path)) {
      try {
        await requireStaff(request, env, slug);
        if (request.method !== "GET") sameOrigin(request, env);
        return await editorRequest(routedRequest(request, path), env,
          request.method === "GET" ? undefined : await body(request, 1048576), slug);
      } catch (error) {
        return json({ ...(error instanceof ApiError && error.status === 409 ? error.extra : {}),
          error: error instanceof ApiError ? error.code : "internal_error" },
        error instanceof ApiError ? error.status : 500);
      }
    }
    const assetPath = path.replace(/^\/page\/(?=(?:logo|assets\/notice)\/)/, "/");
    const safe = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const assetPattern = new RegExp(`^(?:/logo/${safe}|/assets/notice/${safe}-[a-f0-9]{12})\\.(?:png|jpg|jpeg|gif|webp)$`);
    if (request.method === "GET" && (path === "/api/customer" || path === "/page/"
        || assetPattern.test(assetPath))) {
      try {
        if (new URL(request.url).searchParams.has("edit")) await requireStaff(request,env,slug);
        else {
          const session = await customerSession(request,env);
          if (session?.slug !== slug) await requireStaff(request,env,slug);
        }
        if (path === "/page/")
          return customerPage(new URL(request.url).searchParams.has("edit"), slug);
        const store = createPrivateStore(env);
        if (path === "/api/customer") {
          const latest = await store.latest(slug);
          if (!latest) return json({error:"data_not_ready"},503);
          if (!["bowlgames", "dameungyeol"].includes(slug)) return json(latest.payload);
          try {
            const selected = await selectedPrograms(env, slug);
            const catalog = selected.length ? await policyCatalog() : [];
            return json({ ...latest.payload,
              recommend: customerRecommendations(selected, catalog) });
          } catch { return json({ ...latest.payload, recommend: [], recommend_unavailable: true }); }
        }
        const asset = await store.asset(slug,assetPath.slice(1));
        if (!asset) return json({error:"not_found"},404);
        return new Response(Uint8Array.from(atob(asset.content_base64),c=>c.charCodeAt(0)),{headers:{
          'content-type':asset.content_type,'cache-control':'no-store','x-content-type-options':'nosniff',
          'content-security-policy':"default-src 'none'; sandbox",'x-frame-options':'DENY'}});
      } catch (error) {
        // 고객·PM 모두 세션 없는 깊은 링크는 오류 JSON 대신 각 로그인으로 보낸다.
        // 상대 경로를 쓰면 Pages 프록시를 거쳐도 현재 고객 도메인에 머문다.
        if (path === "/page/"
            && error instanceof ApiError && error.status === 401)
          return new Response(null, { status: 302, headers: {
            location: `/${slug}/${url.searchParams.has("edit") ? '?edit' : ''}`, "cache-control": "no-store",
          } });
        return json({error:error instanceof ApiError ? error.code : "internal_error"},error instanceof ApiError ? error.status : 500);
      }
    }
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
        const current = session?.slug === slug ? session : null;
        return json({ authenticated: !!current, ...(current ? { slug: current.slug } : {}) });
      }
      if (path === "/auth/customer/login") {
        const input = await body(request);
        if (input.slug !== slug) throw new ApiError(403, "not_assigned");
        const token = await customerLogin(request, env, input);
        return json({ authenticated: true, slug }, 200, sessionCookie("customer", token));
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
        const scope = await resolveStaff(env, identity.email, slug);
        const token = await createStaffSession(env, identity);
        // 기존 PM 세션도 지워 로그인 시 토큰을 교체한다.
        await logout(request, env, "staff");
        const response = json({ authenticated: true, ...scope }, 200, sessionCookie("staff", token));
        response.headers.append("set-cookie", nonceCookie());
        return response;
      }
      const scope = await requireStaff(request, env, slug);
      if (path === "/auth/staff/session") return json({ authenticated: true, ...scope });
      const input = await body(request);
      if (input.slug !== slug) throw new ApiError(403, "not_assigned");
      await setCustomerPassword(env, slug, input.password);
      return json({ changed: true, slug: scope.slug });
    } catch (error) {
      // upstream 설명·SQL·비밀번호·토큰은 응답이나 로그에 남기지 않는다.
      return json({ error: error instanceof ApiError ? error.code : "internal_error" },
        error instanceof ApiError ? error.status : 500);
    }
  },
};
