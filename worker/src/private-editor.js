import { ApiError } from "./error.js";
import relay from "./index.js";

export const EDITOR_ROUTES = new Map([
  ["/notice/doc", ["POST"]], ["/notice/doc/draft", ["GET", "PUT"]],
  ["/notice/doc/publish", ["POST"]], ["/notice/doc/revisions", ["GET"]],
  ["/notice/doc/revision-to-draft", ["POST"]], ["/room/rebuild", ["POST"]],
  ["/room/pin", ["PUT"]], ["/talk/major", ["PUT"]],
]);
const REBUILD_ROUTES = new Set(["/notice/doc/publish", "/room/rebuild", "/room/pin", "/talk/major"]);

export async function requestPrivateRebuild(env, slug) {
  try {
    await env.PRIVATE_DB.prepare(`INSERT INTO private_rebuild_job(slug, requested_at, state)
      VALUES (?, ?, 'requested') ON CONFLICT(slug) DO UPDATE SET
      requested_at = excluded.requested_at, attempts = 0,
      state = CASE WHEN private_rebuild_job.state = 'running' THEN 'running' ELSE 'requested' END,
      last_error = NULL`).bind(slug, Date.now()).run();
    return "sent";
  } catch { return "failed"; }
}

// 호출자는 먼저 Google 세션·Notion 권한·Origin을 확인한다. 기존 편집 로직만 재사용한다.
export async function editorRequest(request, env, input, routeSlug = "whiffkorea") {
  const url = new URL(request.url);
  if (!EDITOR_ROUTES.get(url.pathname)?.includes(request.method))
    throw new ApiError(405, "method_not_allowed");
  const slug = request.method === "GET" ? url.searchParams.get("slug") : input?.slug;
  if (slug !== routeSlug || (request.method === "GET" && url.searchParams.getAll("slug").length !== 1))
    throw new ApiError(403, "not_assigned");

  const internal = crypto.randomUUID();
  const headers = new Headers({ authorization: `Bearer ${btoa(internal)}` });
  if (input !== undefined) headers.set("content-type", "application/json");
  const trusted = new Request(url, { method: request.method, headers,
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const response = await relay.fetch(trusted, { ...env, EDITOR_PASSWORD: internal,
    GITHUB_DISPATCH_TOKEN: undefined, GITHUB_REPO: undefined });
  const data = await response.json();
  if (response.ok && REBUILD_ROUTES.has(url.pathname) && data.rebuild !== "not_needed")
    data.rebuild = await requestPrivateRebuild(env, routeSlug);
  return Response.json(data, { status: response.status, headers: {
    "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
}
