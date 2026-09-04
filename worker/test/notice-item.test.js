import { afterEach, beforeEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  ENV, ITEM, NESTED, NOTICE_PAGE, OTHER_PAGE, OUTSIDER,
  block, inPage, installNotion, run, world, writes,
} from "./helpers.js";

/**
 * 화면이 하는 것과 같게 — 비밀번호는 base64(UTF-8) 로 싣는다.
 * HTTP 헤더에는 바이트 하나가 한 글자라 한글을 그대로 넣을 수 없다.
 */
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** 창구를 두드린다. password 를 주지 않으면 Authorization 을 아예 안 붙인다. */
function call(method, path, { body, password, origin } = {}) {
  const headers = {};
  if (password !== undefined) headers.authorization = `Bearer ${b64(password)}`;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://relay.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ENV,
  );
}

const good = ENV.EDITOR_PASSWORD;
const editBody = (over = {}) => ({ slug: "whiffkorea", blockId: ITEM, markdown: "고친 글", ...over });

describe("POST /auth", () => {
  beforeEach(() => installNotion());

  it("비밀번호가 맞으면 200", async () => {
    const res = await call("POST", "/auth", { password: good });
    expect(res.status).toBe(200);
  });

  it("비밀번호가 틀리면 401", async () => {
    const res = await call("POST", "/auth", { password: "wrong-pw" });
    expect(res.status).toBe(401);
  });

  it("Authorization 이 아예 없으면 401", async () => {
    const res = await call("POST", "/auth");
    expect(res.status).toBe(401);
  });
});

describe("비밀번호를 통과하지 못하면 노션에 닿지 않는다", () => {
  it("없을 때 — 노션 호출이 한 번도 없다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", { body: editBody() });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("틀렸을 때 — 노션 호출이 한 번도 없다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", { body: editBody(), password: "wrong-pw" });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("PUT /notice/item — 남의 것은 건드리지 않는다", () => {
  it("모르는 슬러그면 404, 쓰지 않는다", async () => {
    const { calls } = installNotion({ share: { results: [] } });
    const res = await call("PUT", "/notice/item",
                           { body: editBody({ slug: "없는기업" }), password: good });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });

  it("다른 기업 공지의 blockId 면 404, 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item",
                           { body: editBody({ blockId: OUTSIDER }), password: good });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });

  it("노션에 없는 blockId 면 404, 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", {
      body: editBody({ blockId: "99999999-0000-0000-0000-000000000000" }),
      password: good,
    });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("PUT /notice/item — 잠긴 항목", () => {
  const lockedCases = [
    ["링크", [run("공고문", {}, { href: "https://example.com" })]],
    ["밑줄", [run("중요", { underline: true })]],
    ["글자색", [run("기업인증", { color: "orange" })]],
    ["커스텀 이모지", [{ type: "mention", mention: { type: "custom_emoji", custom_emoji: { url: "u" } }, plain_text: ":x:", annotations: {} }]],
  ];

  it.each(lockedCases)("%s 이 들어 있으면 409, 쓰지 않는다", async (_name, runs) => {
    const { calls } = installNotion({
      blocks: world({ [ITEM]: block(ITEM, "paragraph", runs, inPage(NOTICE_PAGE)) }),
    });
    const res = await call("PUT", "/notice/item", { body: editBody(), password: good });

    expect(res.status).toBe(409);
    expect(writes(calls)).toHaveLength(0);
  });

  it("공지 항목이 아닌 블록(첨부)이면 404, 쓰지 않는다", async () => {
    const { calls } = installNotion({
      blocks: world({ [ITEM]: { object: "block", id: ITEM, type: "file",
                                parent: inPage(NOTICE_PAGE), file: {} } }),
    });
    const res = await call("PUT", "/notice/item", { body: editBody(), password: good });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("PUT /notice/item — 고치기", () => {
  it("노션의 그 줄이 바뀌고, 화면에 그릴 HTML 이 돌아온다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", {
      body: editBody({ markdown: "연구인력 **5명** → 4명" }),
      password: good,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ html: "연구인력 <b>5명</b> → 4명" });

    const patch = writes(calls);
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({ method: "PATCH", path: `/blocks/${ITEM}` });
    expect(patch[0].body.bulleted_list_item.rich_text.map((r) => [
      r.text.content, r.annotations.bold,
    ])).toEqual([["연구인력 ", false], ["5명", true], [" → 4명", false]]);
  });

  it("한 겹 안쪽 항목도 고칠 수 있다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", {
      body: editBody({ blockId: NESTED, markdown: "서면평가 진행중" }),
      password: good,
    });

    expect(res.status).toBe(200);
    expect(writes(calls)[0].path).toBe(`/blocks/${NESTED}`);
  });

  it("취소선과 인라인 코드가 노션 서식으로 나간다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", {
      body: editBody({ markdown: "~~미선정~~ `2026-05-01`" }),
      password: good,
    });

    await expect(res.json()).resolves.toEqual({ html: "<s>미선정</s> <code>2026-05-01</code>" });
    const sent = writes(calls)[0].body.bulleted_list_item.rich_text;
    expect(sent[0].annotations.strikethrough).toBe(true);
    expect(sent[2].annotations.code).toBe(true);
  });

  it("인용은 빌더와 같이 blockquote 로 감싼다", async () => {
    installNotion({
      blocks: world({ [ITEM]: block(ITEM, "quote", [run("옛 글")], inPage(NOTICE_PAGE)) }),
    });
    const res = await call("PUT", "/notice/item", {
      body: editBody({ markdown: "새 글" }), password: good,
    });

    await expect(res.json()).resolves.toEqual({ html: "<blockquote>새 글</blockquote>" });
  });

  it("HTML 로 읽힐 글자는 이스케이프한다", async () => {
    installNotion();
    const res = await call("PUT", "/notice/item", {
      body: editBody({ markdown: "a < b & <script>" }), password: good,
    });

    await expect(res.json()).resolves.toEqual({
      html: "a &lt; b &amp; &lt;script&gt;",
    });
  });

  it("닫히지 않은 표시는 422, 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", {
      body: editBody({ markdown: "**닫지 않았다" }), password: good,
    });

    expect(res.status).toBe(422);
    expect(writes(calls)).toHaveLength(0);
  });

  it("빈 내용은 422, 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const res = await call("PUT", "/notice/item", {
      body: editBody({ markdown: "   " }), password: good,
    });

    expect(res.status).toBe(422);
    expect(writes(calls)).toHaveLength(0);
  });

  it("노션이 5xx 를 주면 502", async () => {
    installNotion({
      fail: (method, path) =>
        (method === "PATCH" && path.startsWith("/blocks/"))
          ? new Response(JSON.stringify({ message: "conflict_error" }), { status: 502 })
          : null,
    });
    const res = await call("PUT", "/notice/item", { body: editBody(), password: good });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "notion_failed" });
  });

  it("노션 토큰이 화면 쪽 비밀번호가 아니라 서버 것으로 나간다", async () => {
    const { calls } = installNotion();
    await call("PUT", "/notice/item", { body: editBody(), password: good });

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.auth).toBe(`Bearer ${ENV.NOTION_TOKEN}`);
    }
  });
});

describe("GET /notice/item — 입력칸에 넣을 글", () => {
  it("화면에 보이는 글이 아니라 노션에 있는 글을 준다", async () => {
    // 빌드는 후행 콜론을 떼고 보여 준다. 보이는 대로 저장하면 콜론이 사라진다.
    installNotion({
      blocks: world({
        [ITEM]: block(ITEM, "bulleted_list_item", [run("연구주제 :")], inPage(NOTICE_PAGE)),
      }),
    });
    const res = await call("GET", `/notice/item?slug=whiffkorea&blockId=${ITEM}`,
                           { password: good });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toBe("연구주제 :");    // 노션에 있는 그대로
    expect(body.html).toBe("연구주제");          // 화면은 콜론을 뗀 모양
    expect(body.type).toBe("bulleted_list_item");
  });

  it("서식은 마크다운 표시로 돌아온다", async () => {
    installNotion({
      blocks: world({
        [ITEM]: block(ITEM, "paragraph", [
          run("정책자금 "), run("2억원", { bold: true }), run(" 기표완료"),
        ], inPage(NOTICE_PAGE)),
      }),
    });
    const res = await call("GET", `/notice/item?slug=whiffkorea&blockId=${ITEM}`,
                           { password: good });

    await expect(res.json()).resolves.toMatchObject({
      markdown: "정책자금 **2억원** 기표완료",
    });
  });

  it("마크다운 표시로 읽힐 글자는 그대로 보이게 한다", async () => {
    installNotion({
      blocks: world({
        [ITEM]: block(ITEM, "paragraph", [run("2*3 = 6 · a**b")], inPage(NOTICE_PAGE)),
      }),
    });
    const res = await call("GET", `/notice/item?slug=whiffkorea&blockId=${ITEM}`,
                           { password: good });
    const { markdown } = await res.json();

    expect(markdown).toBe("2\\*3 = 6 · a\\*\\*b");

    // 그대로 되돌려 저장하면 노션의 글이 그대로여야 한다.
    const { calls } = installNotion();
    await call("PUT", "/notice/item",
               { body: editBody({ markdown }), password: good });
    const sent = writes(calls)[0].body.bulleted_list_item.rich_text;
    expect(sent.map((r) => r.text.content).join("")).toBe("2*3 = 6 · a**b");
  });

  it("비밀번호가 없으면 401, 노션 호출이 없다", async () => {
    const { calls } = installNotion();
    const res = await call("GET", `/notice/item?slug=whiffkorea&blockId=${ITEM}`);

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("slug 가 없으면 422", async () => {
    installNotion();
    const res = await call("GET", `/notice/item?blockId=${ITEM}`, { password: good });
    expect(res.status).toBe(422);
  });
});

describe("브라우저에서 부를 수 있는가", () => {
  it("클라이언트 페이지 출처의 preflight 를 허용한다", async () => {
    installNotion();
    const res = await call("OPTIONS", "/notice/item",
                           { origin: "https://bluep2000-hub.github.io" });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin"))
      .toBe("https://bluep2000-hub.github.io");
  });

  it("모르는 출처에는 허용 헤더를 주지 않는다", async () => {
    installNotion();
    const res = await call("OPTIONS", "/notice/item", { origin: "https://evil.example" });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
