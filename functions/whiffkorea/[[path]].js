const WORKER_ORIGIN = "https://growthhigh-clientpage-private.growthhigh-clientpage-worker.workers.dev";

export async function onRequest({ request, env }) {
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
  return env.PRIVATE_WORKER.fetch(new Request(target, init));
}
