/**
 * `PUT /room/pin` — 담당자가 데이터룸 자료를 즐겨찾기에 고정하거나 해제한다.
 */

import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { COMPANY_PAGE, dispatches, ENV, installNotion, run, writes } from "./helpers.js";

const good = Buffer.from(ENV.EDITOR_PASSWORD, "utf8").toString("base64");
const NOTE = "https://www.notion.so/research-note";

function call(body, password = good) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${password}`;
  return worker.fetch(new Request("https://relay.test/room/pin", {
    method: "PUT", headers, body: JSON.stringify(body),
  }), ENV);
}

const share = (pins = "") => ({
  results: [{
    id: "share-row",
    properties: {
      "슬러그": { type: "rich_text", rich_text: [run("whiffkorea")] },
      "기업 DB": { type: "relation", relation: [{ id: COMPANY_PAGE }] },
      "추가 링크": { type: "rich_text", rich_text: [run(`R&D\n연구노트 | ${NOTE}`)] },
      "고정 자료": { type: "rich_text", rich_text: pins ? [run(pins)] : [] },
    },
  }],
});

describe("PUT /room/pin", () => {
  it("소통 이력 이전을 검증하지 않은 기업은 저장·재빌드를 막는다", async () => {
    const { calls } = installNotion({ share: share() });
    const res = await call({ slug: "studiolb", url: NOTE, pinned: true });

    expect(res.status).toBe(422);
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("담당자 인증이 없으면 거절한다", async () => {
    const { calls } = installNotion({ share: share() });
    const res = await call({ slug: "whiffkorea", url: NOTE, pinned: true }, null);

    expect(res.status).toBe(401);
    expect(writes(calls)).toHaveLength(0);
  });

  it("그 기업에 걸리지 않은 주소는 고정하지 않는다", async () => {
    const { calls } = installNotion({ share: share() });
    const res = await call({ slug: "whiffkorea", url: "https://evil.example/", pinned: true });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("고정하면 「고정 자료」에 한 줄 보태고 재빌드한다", async () => {
    const { calls } = installNotion({ share: share("https://drive.google.com/x") });
    const res = await call({ slug: "whiffkorea", url: NOTE, pinned: true });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ url: NOTE, pinned: true, rebuild: "sent" });
    expect(writes(calls)).toEqual([expect.objectContaining({
      method: "PATCH",
      path: "/pages/share-row",
      body: { properties: { "고정 자료": { rich_text: [
        { text: { content: `https://drive.google.com/x\n${NOTE}` } }] } } },
    })]);
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("해제하면 그 줄만 빠지고, 마지막이면 칸을 비운다", async () => {
    const { calls } = installNotion({ share: share(NOTE) });
    const res = await call({ slug: "whiffkorea", url: NOTE, pinned: false });

    expect(res.status).toBe(200);
    expect(writes(calls)[0].body).toEqual({ properties: { "고정 자료": { rich_text: [] } } });
  });

  it("이미 같은 상태면 쓰거나 재빌드하지 않는다", async () => {
    const { calls } = installNotion({ share: share(NOTE) });
    const res = await call({ slug: "whiffkorea", url: NOTE, pinned: true });

    await expect(res.json()).resolves.toMatchObject({ rebuild: "skipped" });
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });
});
