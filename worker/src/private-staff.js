import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError, unauthorized } from "./error.js";
import { createNotion, findClient, sameId } from "./notion.js";
import { setupError, staffSession } from "./private-auth.js";

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export async function verifyGoogleToken(token, clientId, nonce, keys = GOOGLE_KEYS) {
  if (!clientId) throw setupError();
  if (typeof token !== "string" || !token.length || token.length > 12000) throw unauthorized();
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"], audience: clientId,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      requiredClaims: ["sub", "email", "email_verified", "exp", "iat", "nonce"],
    });
    if (payload.email_verified !== true || typeof payload.email !== "string"
        || !payload.email.includes("@") || typeof payload.sub !== "string" || !payload.sub
        || typeof payload.iat !== "number" || !Number.isFinite(payload.iat)
        || payload.nonce !== nonce || payload.iat > Date.now() / 1000 + 60)
      throw unauthorized();
    return { sub: payload.sub, email: payload.email.toLowerCase(), exp: payload.exp };
  } catch (error) {
    if (error.code?.startsWith("ERR_JWKS") || error instanceof TypeError)
      throw new ApiError(503, "google_unavailable");
    throw unauthorized();
  }
}

/** Notion이 권한 원본이다. 매 요청에서 읽어 삭제·담당 변경을 즉시 확인한다. */
export async function resolveStaff(env, email) {
  if (!env.INTERNAL_USERS_DB_ID || !env.NOTION_TOKEN) throw setupError();
  if (!/^[0-9a-f-]{32,36}$/i.test(env.INTERNAL_USERS_DB_ID)) throw setupError();
  const nt = createNotion(env);
  const found = await nt.post(`/databases/${env.INTERNAL_USERS_DB_ID}/query`, {
    filter: { property: "이메일", email: { equals: email } }, page_size: 2,
  });
  if (found.has_more || found.results?.length !== 1) throw new ApiError(403, "staff_not_registered");
  const user = found.results[0];
  const role = user.properties?.["역할"]?.select?.name;
  if (user.archived || user.in_trash || !["PM", "대표"].includes(role))
    throw new ApiError(403, "staff_not_registered");
  if (role === "PM") {
    const client = await findClient(nt, "whiffkorea");
    const scope = user.properties?.["담당 기업"];
    if (scope?.has_more || !scope?.relation?.some((item) => sameId(item.id, client.id)))
      throw new ApiError(403, "not_assigned");
  }
  return { role, slug: "whiffkorea" };
}
export async function requireStaff(request, env) {
  const session = await staffSession(request, env);
  return resolveStaff(env, session.email);
}
