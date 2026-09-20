// 등록된 고객 비밀번호 목록을 기준으로 각 기업의 승인 데이터만 D1에 저장한다.
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,rm,rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {snapshotScript} from "./private-snapshot-sql.mjs";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("../",import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js",import.meta.url));
const target = process.argv.includes("--local") ? "--local" : "--remote";
const args = [wrangler,"d1","execute","growthhigh-clientpage-private","--config","wrangler.private.toml",target,"--json"];
const literal = value => typeof value === "number" ? String(value) : "'"+String(value).replaceAll("'","''")+"'";
const requested = process.argv.find(value => value.startsWith("--client="))?.slice(9);

async function d1(sql, options = {}) {
  const {stdout} = await run(process.execPath,[...args,"--command",sql],{cwd,timeout:120000,...options});
  return JSON.parse(stdout)[0]?.results || [];
}

async function activeSlugs() {
  if (requested) return [requested];
  return (await d1("SELECT slug FROM customer_credentials ORDER BY slug")).map(row => row.slug);
}

async function finishRequestedBuild(slug, started, state, reason = null) {
  const completed = state === "completed" ? Date.now() : "NULL";
  const attempts = state === "failed" ? "attempts + 1" : "attempts";
  const sql = `UPDATE private_rebuild_job SET state=${literal(state)}, completed_at=${completed},
    attempts=${attempts}, last_error=${reason ? literal(reason) : "NULL"}, lease_owner=NULL, lease_until=NULL
    WHERE slug=${literal(slug)} AND requested_at <= ${started}`;
  try { await d1(sql); } catch { /* 정상 결과 저장 여부가 갱신 로그 기록보다 우선이다. */ }
}

function publicReason(error) {
  const signal = `${error?.message || ""}\n${error?.stderr || ""}\n${error?.stdout || ""}`;
  const known = [
    [/too (?:many|large)|SQLITE_TOOBIG|statement.*(?:long|limit)/i, "d1_size_limit"],
    [/foreign key/i, "d1_foreign_key"], [/syntax error|parse error/i, "d1_sql_syntax"],
    [/no such (?:table|column)/i, "d1_schema_missing"],
    [/constraint failed|UNIQUE constraint/i, "d1_constraint"],
    [/transaction|cannot start/i, "d1_transaction"], [/timed out|ETIMEDOUT/i, "d1_timeout"],
  ];
  return /^(?:invalid_|missing_|customer_assets_|payload_|incomplete_)[a-z_]+$/.test(error?.message)
    ? error.message : known.find(([pattern]) => pattern.test(signal))?.[1] || "private_build_failed";
}

async function buildOne(slug) {
  let stage = "collect";
  const started = Date.now();
  try {
    const {stdout} = await run(process.env.PRIVATE_BUILD_PYTHON || "python",
      [fileURLToPath(new URL("../../src/build_private.py",import.meta.url)),"--client",slug],
      {cwd,timeout:600000,maxBuffer:16000000,windowsHide:true});
    const result = JSON.parse(stdout);
    if (result.slug !== slug) throw new Error("invalid_snapshot_request");
    stage = "validate";
    const sql = snapshotScript(result).join("\n");
    const directory = await mkdtemp(join(tmpdir(),"growthhigh-private-build-"));
    const file = join(directory,"snapshot.sql");
    try {
      stage = "save";
      await writeFile(file,sql,{mode:0o600});
      await run(process.execPath,[...args,"--file",file],{cwd,maxBuffer:2000000,timeout:120000,windowsHide:true});
      const check = await d1(`SELECT count(*) AS n FROM customer_snapshots WHERE slug=${literal(slug)} AND ready=1 AND build_key=${literal(result.buildKey)}`);
      if (check[0]?.n !== 1) throw new Error("private_build_verification_failed");
      await finishRequestedBuild(slug, started, "completed");
      return {saved:true,target,slug,assets:Object.keys(result.assets).length};
    } finally {
      await rm(file,{force:true}); await rmdir(directory);
    }
  } catch (error) {
    const reason = publicReason(error);
    await finishRequestedBuild(slug, started, "failed", reason);
    return {saved:false,slug,stage,reason,exitCode:Number.isInteger(error?.code)?error.code:null,
      stdoutBytes:Buffer.byteLength(error?.stdout || ""),stderrBytes:Buffer.byteLength(error?.stderr || "")};
  }
}

const slugs = await activeSlugs();
const results = [];
for (const slug of slugs) results.push(await buildOne(slug));
console.log(JSON.stringify({target,clients:results}));
if (results.some(result => !result.saved)) process.exitCode = 1;
