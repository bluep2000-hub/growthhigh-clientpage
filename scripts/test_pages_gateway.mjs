import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { onRequest } from "../functions/[[path]].js";

const root = new URL("../", import.meta.url);
const present = (path) => access(new URL(path, root)).then(() => true, () => false);

for (const path of ["pages-dist/index.html", "pages-dist/zeroback/index.html",
  "pages-dist/assets/growthhigh-logo.png", "pages-dist/404.html", "pages-dist/_routes.json"])
  assert.equal(await present(path), true, `${path} must be deployed`);
for (const path of ["pages-dist/whiffkorea/index.html", "pages-dist/c/whiffkorea.enc",
  "pages-dist/worker/src/private-index.js", "pages-dist/docs", "pages-dist/src"])
  assert.equal(await present(path), false, `${path} must stay private`);

assert.deepEqual(JSON.parse(await readFile(new URL("pages-dist/_routes.json", root), "utf8")), {
  version: 1, include: ["/*"],
  exclude: ["/assets/*", "/logo/*", "/_verify/*", "/favicon.ico", "/robots.txt"],
});

let forwarded;
const env = { PRIVATE_WORKER: { fetch(request) {
  forwarded = request;
  return new Response("ok");
} } };
const good = new Request("https://client.growthhigh.co.kr/whiffkorea/auth/customer/login", {
  method: "POST",
  headers: { origin: "https://client.growthhigh.co.kr", "content-type": "application/json" },
  body: "{}",
});
assert.equal((await onRequest({ request: good, env, next: () => new Response("static") })).status, 200);
assert.equal(forwarded.method, "POST");
assert.equal(new URL(forwarded.url).origin,
  "https://growthhigh-clientpage-private.growthhigh-clientpage-worker.workers.dev");
assert.equal(forwarded.headers.get("origin"),
  "https://growthhigh-clientpage-private.growthhigh-clientpage-worker.workers.dev");

const bad = new Request("https://client.growthhigh.co.kr/whiffkorea/auth/customer/login", {
  method: "POST",
  headers: { origin: "https://evil.example", "content-type": "application/json" },
  body: "{}",
});
assert.equal((await onRequest({ request: bad, env, next: () => new Response("static") })).status, 403);

env.PRIVATE_WORKER.fetch = () => Response.json({error:"not_found"},{status:404});
assert.equal(await (await onRequest({request:new Request("https://client.growthhigh.co.kr/zeroback/"),env,
  next:() => new Response("static")})).text(), "static");

const missingDraft = await onRequest({request:new Request(
  "https://client.growthhigh.co.kr/bowlgames/notice/doc/draft?slug=bowlgames"),env,
  next:() => new Response("static")});
assert.equal(missingDraft.status, 404);
assert.deepEqual(await missingDraft.json(), {error:"not_found"});

console.log("Cloudflare Pages gateway checks passed");
