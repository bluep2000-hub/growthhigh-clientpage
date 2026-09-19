// Notion 공개 승인 필터 재사용 → 비공개 D1 저장. GitHub·공개 산출물을 쓰지 않는다.
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
let stage='collect';

async function build() {
  const {stdout} = await run(process.env.PRIVATE_BUILD_PYTHON || "python",
    [fileURLToPath(new URL("../../src/build_private.py",import.meta.url))],
    {cwd,timeout:600000,maxBuffer:16000000,windowsHide:true});
  const result = JSON.parse(stdout);
  stage='validate';
  const sql = snapshotScript(result).join("\n");
  // 웹 저장소 밖에 잠깐 저장하고 항상 삭제한다. 원문/이미지/SQL을 로그로 남기지 않는다.
  const directory = await mkdtemp(join(tmpdir(),"growthhigh-private-build-"));
  const file = join(directory,"snapshot.sql");
  try {
    stage='save';
    await writeFile(file,sql,{mode:0o600});
    await run(process.execPath,[...args,"--file",file],{cwd,maxBuffer:2000000,timeout:120000,windowsHide:true});
    const {stdout:check} = await run(process.execPath,[...args,"--command",
      `SELECT count(*) AS n FROM customer_snapshots WHERE slug='whiffkorea' AND ready=1 AND build_key=${literal(result.buildKey)}`],{cwd});
    if (JSON.parse(check)[0]?.results?.[0]?.n !== 1) throw new Error("private_build_verification_failed");
    console.log(JSON.stringify({saved:true,target,slug:"whiffkorea",assets:Object.keys(result.assets).length}));
  } finally {
    await rm(file,{force:true}); await rmdir(directory);
  }
}
try { await build(); }
catch(error) {
  const signal = `${error?.message || ""}\n${error?.stderr || ""}\n${error?.stdout || ""}`;
  const known = [
    [/too (?:many|large)|SQLITE_TOOBIG|statement.*(?:long|limit)/i, "d1_size_limit"],
    [/foreign key/i, "d1_foreign_key"],
    [/syntax error|parse error/i, "d1_sql_syntax"],
    [/no such (?:table|column)/i, "d1_schema_missing"],
    [/constraint failed|UNIQUE constraint/i, "d1_constraint"],
    [/transaction|cannot start/i, "d1_transaction"],
    [/timed out|ETIMEDOUT/i, "d1_timeout"],
  ];
  const reason = /^(?:invalid_|missing_|customer_assets_|payload_)[a-z_]+$/.test(error?.message)
    ? error.message : known.find(([pattern]) => pattern.test(signal))?.[1] || "private_build_failed";
  console.error(JSON.stringify({saved:false,stage,reason,exitCode:Number.isInteger(error?.code)?error.code:null,
    stdoutBytes:Buffer.byteLength(error?.stdout || ""),stderrBytes:Buffer.byteLength(error?.stderr || "")}));
  process.exitCode=1;
}
