const WORKER_ORIGIN = "https://growthhigh-clientpage-private.growthhigh-clientpage-worker.workers.dev";
const BSHARE_PUBLIC_PATH = "/bshare";
const BSHARE_STORAGE_PATH = "/beshare";

export async function onRequest({ request, env, next }) {
  const incoming = new URL(request.url);
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)
      && (request.headers.get("origin") !== incoming.origin
        || request.headers.get("sec-fetch-site") === "cross-site")) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const legacyPage = /^\/beshare(\/?|\/page\/?|\/index\.html)$/.exec(incoming.pathname);
  if (legacyPage && ["GET", "HEAD"].includes(request.method)) {
    const page = legacyPage[1].startsWith("/page") ? "/page/" : "/";
    return new Response(null, { status: 302, headers: {
      location: BSHARE_PUBLIC_PATH + page + incoming.search,
      "cache-control": "no-store",
    } });
  }

  // Keep the customer identity used by authentication, snapshots and scheduled jobs.
  const isBshare = incoming.pathname === BSHARE_PUBLIC_PATH
    || incoming.pathname.startsWith(BSHARE_PUBLIC_PATH + "/");
  const target = new URL(WORKER_ORIGIN);
  target.pathname = isBshare
    ? BSHARE_STORAGE_PATH + incoming.pathname.slice(BSHARE_PUBLIC_PATH.length)
    : incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  if (headers.has("origin")) headers.set("origin", WORKER_ORIGIN);
  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
    init.duplex = "half";
  }
  const response = await env.PRIVATE_WORKER.fetch(new Request(target, init));
  const location = response.headers.get("location");
  if (isBshare && location?.startsWith(BSHARE_STORAGE_PATH + "/")) {
    const redirectHeaders = new Headers(response.headers);
    redirectHeaders.set("location", BSHARE_PUBLIC_PATH + location.slice(BSHARE_STORAGE_PATH.length));
    return new Response(response.body, { status: response.status, headers: redirectHeaders });
  }

  const staticPath = incoming.pathname === "/"
    || /^\/[^/]+\/?$/.test(incoming.pathname)
    || /^\/[^/]+\/index\.html$/.test(incoming.pathname)
    || /^\/c\/[^/]+\.json$/.test(incoming.pathname)
    || /^\/c\/[^/]+\.enc$/.test(incoming.pathname);
  return response.status === 404 && staticPath && ["GET", "HEAD"].includes(request.method)
    ? next() : response;
}
