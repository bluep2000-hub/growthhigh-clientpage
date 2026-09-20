const WORKER_ORIGIN = "https://growthhigh-clientpage-private.growthhigh-clientpage-worker.workers.dev";

export async function onRequest({ request, env, next }) {
  const incoming = new URL(request.url);
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)
      && (request.headers.get("origin") !== incoming.origin
        || request.headers.get("sec-fetch-site") === "cross-site")) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const target = new URL(incoming.pathname + incoming.search, WORKER_ORIGIN);
  const headers = new Headers(request.headers);
  if (headers.has("origin")) headers.set("origin", WORKER_ORIGIN);
  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
    init.duplex = "half";
  }
  const response = await env.PRIVATE_WORKER.fetch(new Request(target, init));
  const staticPath = incoming.pathname === "/"
    || /^\/[^/]+\/?$/.test(incoming.pathname)
    || /^\/[^/]+\/index\.html$/.test(incoming.pathname)
    || /^\/c\/[^/]+\.enc$/.test(incoming.pathname);
  return response.status === 404 && staticPath && ["GET", "HEAD"].includes(request.method)
    ? next() : response;
}
