import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyGoogleToken } from "../src/private-staff.js";

describe("Google 발급 증명 검증", () => {
  let privateKey;
  let keys;
  const clientId = "test.apps.googleusercontent.com";
  const nonce = "unit-nonce";
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test", alg: "RS256" }] });
  });
  function token(overrides = {}, key = privateKey) {
    return new SignJWT({ sub: "google-sub", email: "PM@example.com", email_verified: true,
      nonce, iss: "https://accounts.google.com", aud: clientId,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(key);
  }
  it("서명·Google 발급자·대상 앱·nonce가 맞는 증명만 허용한다", async () => {
    expect(await verifyGoogleToken(await token(), clientId, nonce, keys))
      .toMatchObject({ sub: "google-sub", email: "pm@example.com" });
  });
  it("다른 앱·발급자·nonce·미인증 이메일·만료 증명을 거절한다", async () => {
    for (const claims of [{ aud: "other-app" }, { iss: "https://evil.test" }, { nonce: "other-nonce" },
      { email_verified: false }, { exp: 1 }, { iat: Math.floor(Date.now() / 1000) + 600 }]) {
      await expect(verifyGoogleToken(await token(claims), clientId, nonce, keys)).rejects.toMatchObject({ status: 401 });
    }
  });
  it("위조 서명과 누락 증명은 거절하고 설정 부재는 성공으로 처리하지 않는다", async () => {
    const other = await generateKeyPair("RS256");
    await expect(verifyGoogleToken(await token({}, other.privateKey), clientId, nonce, keys)).rejects.toMatchObject({ status: 401 });
    await expect(verifyGoogleToken(undefined, clientId, nonce, keys)).rejects.toMatchObject({ status: 401 });
    await expect(verifyGoogleToken(await token(), "", nonce, keys)).rejects.toMatchObject({ status: 503 });
  });
});
