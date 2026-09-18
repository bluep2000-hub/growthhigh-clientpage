/**
 * 운영자가 한 번 실행하는 이관 도구. Notion 원문은 메모리에서만 사용한다.
 * SQL 임시 파일은 웹 저장소 밖에 두고 반드시 삭제한다. 인증값은 출력하지 않는다.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNotion, findClient } from "../src/notion.js";
import { passwordMatches, passwordRecord } from "../src/private-auth.js";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
// 로컬 로그인 검수는 별도 로컬 DB만 사용한다. 기본 원격 이관 방식은 유지한다.
const target = process.argv.includes("--local") ? "--local" : "--remote";
const args = [wrangler, "d1", "execute", "growthhigh-clientpage-private", "--config", "wrangler.private.toml", target, "--json"];

async function readCredential() {
  const { stdout } = await run(process.execPath, [...args, "--command",
    "SELECT password_hash, salt, iterations, version FROM customer_credentials WHERE slug = 'whiffkorea'"], { cwd });
  return JSON.parse(stdout)[0]?.results?.[0] || null;
}
async function provision() {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
  const env = { NOTION_TOKEN: process.env.NOTION_TOKEN, AUTH_PEPPER: process.env.AUTH_PEPPER };
  if (!env.NOTION_TOKEN || !env.AUTH_PEPPER) throw new Error("missing_local_configuration");
  const client = await findClient(createNotion(env), "whiffkorea");
  const prop = client.properties?.["접속 비밀번호"];
  // 기존 빌더 p_text의 원본 읽기 규칙과 맞춘다. 고객 입력은 trim하지 않는다.
  const password = (prop?.rich_text || prop?.title || []).map((run) => run.plain_text ?? run.text?.content ?? "").join("").trim();
  if (!password) throw new Error("missing_existing_password");
  const old = await readCredential();
  if (old) {
    if (!await passwordMatches(env, password, old)) throw new Error("existing_credential_mismatch");
    return { slug: "whiffkorea", created: false, existingPasswordVerified: true };
  }
  const record = await passwordRecord(env, password);
  const directory = await mkdtemp(join(tmpdir(), "growthhigh-private-auth-"));
  const file = join(directory, "credential.sql");
  try {
    // b64 출력에는 SQL 인용 문자가 없다. 원문 비밀번호와 pepper는 SQL에 넣지 않는다.
    await writeFile(file, `INSERT INTO customer_credentials (slug, password_hash, salt, iterations)
      VALUES ('whiffkorea', '${record.password_hash}', '${record.salt}', ${record.iterations})
      ON CONFLICT (slug) DO NOTHING;`, { mode: 0o600 });
    await run(process.execPath, [...args, "--file", file], { cwd });
  } finally {
    await rm(file, { force: true });
    await rmdir(directory);
  }
  if (!await passwordMatches(env, password, await readCredential())) throw new Error("migration_verification_failed");
  return { slug: "whiffkorea", created: true, existingPasswordVerified: true };
}

try {
    console.log(JSON.stringify(await provision()));
} catch {
  console.error("고객 비밀번호 이관을 완료하지 못했습니다. 기존 설정은 덮어쓰지 않습니다.");
  process.exitCode = 1;
}
