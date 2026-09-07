/**
 * 공지 문서를 저장소에서 읽고 저장소에 쓴다 — `GET`·`PUT /notice/doc`.
 *
 * 노션이 아니라 중계 서버의 저장소가 공지의 원본이 되는 첫 걸음이다
 * (`docs/adr/0004-공지-원본-이사.md`). 담당자에게 보이는 변화는 아직 없다 —
 * 노션 경로가 그대로 살아 있고, 여기서는 그 옆에 새 길을 깔기만 한다.
 *
 * 지켜야 하는 것.
 *
 * - **저장은 문서를 통째로 덮어쓴다.** 줄마다 따로 보내지 않으므로 무게
 *   상한도, 부분 실패도, 「이 줄만 저장 안 됨」도 없다.
 * - **판 번호가 어긋나면 통째로 거절하고 지금 문서를 함께 준다.** 담당자가
 *   견주고 다시 저장한다. 판정은 줄이 아니라 공지 한 건 단위다.
 * - **남의 기업 공지는 읽지도 쓰지도 못한다.** 슬러그와 공지 주소가 함께
 *   와야 하고, 둘이 짝이 아니면 아무것도 하지 않는다.
 * - **항목의 주소는 중계 서버가 붙인다.** 화면이 대는 대로 받으면 같은
 *   주소가 둘이 되어 다음 저장이 엉뚱한 줄을 짚는다.
 *
 * 저장소는 가짜로 갈아 끼운다. SQL 은 `src/store.js` 한 곳에만 있고,
 * 테스트는 창구로만 두드린다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/store.js", () => import("./fake-store.js"));

import worker from "../src/index.js";
import { all, reset, seed, stored } from "./fake-store.js";
import { dispatches, ENV, installNotion } from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const good = ENV.EDITOR_PASSWORD;

/** D1 바인딩이 붙은 세계. 가짜 저장소는 이 값을 보지 않지만 창구는 본다. */
const ENV_DB = { ...ENV, DB: {} };

function read(query = "?slug=whiffkorea", { password = good } = {}) {
  const headers = {};
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request(`https://relay.test/notice/doc${query}`, { headers }), ENV_DB);
}

function write(body, { password = good } = {}) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request("https://relay.test/notice/doc", {
    method: "PUT", headers, body: JSON.stringify(body),
  }), ENV_DB);
}

const item = (extra) => ({ type: "bullet", html: "연구주제 : 패키지 디자인 개발", ...extra });
const section = (extra) => ({ title: "진행 상황", items: [item()], ...extra });

/** 위프코리아의 공지 한 건. 판 번호는 3, 줄 하나. */
function whiff(extra = {}) {
  return seed({
    id: "notice-1", slug: "whiffkorea", date: "2026-07-31",
    title: "2026년 7월 공지", version: 3,
    sections: [{ id: "s1", title: "진행 상황",
                 items: [{ id: "n1", type: "bullet", html: "지난 줄", items: [] }] }],
    ...extra,
  });
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(() => { reset(); });

describe("GET /notice/doc", () => {
  it("그 기업의 최신 공지 문서를 준다", async () => {
    whiff();

    const res = await read();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      noticeId: "notice-1", slug: "whiffkorea", date: "2026-07-31",
      title: "2026년 7월 공지", version: 3,
      sections: [{ id: "s1", title: "진행 상황",
                   items: [{ id: "n1", type: "bullet", html: "지난 줄", items: [] }] }],
    });
  });

  it("공지가 여러 건이면 날짜가 가장 최근인 것을 준다", async () => {
    whiff();
    seed({ id: "notice-2", slug: "whiffkorea", date: "2026-08-31", title: "8월 공지" });

    const res = await read();

    await expect(res.json()).resolves.toMatchObject({ noticeId: "notice-2" });
  });

  it("공지가 한 건도 없으면 404 다", async () => {
    const res = await read();

    expect(res.status).toBe(404);
  });

  it("남의 기업 공지는 자기 슬러그로만 열린다", async () => {
    whiff();

    const res = await read("?slug=zeroback");

    expect(res.status).toBe(404);
  });

  it("비밀번호가 없으면 401 이다", async () => {
    whiff();

    const res = await read("?slug=whiffkorea", { password: null });

    expect(res.status).toBe(401);
  });

  it("slug 가 없으면 422 다", async () => {
    const res = await read("");

    expect(res.status).toBe(422);
  });
});

describe("PUT /notice/doc", () => {
  it("문서를 통째로 덮어쓰고 판 번호를 하나 올린다", async () => {
    whiff();

    const res = await write({
      slug: "whiffkorea", noticeId: "notice-1", version: 3,
      title: "고친 제목", sections: [section()],
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      noticeId: "notice-1", version: 4, title: "고친 제목",
    });
    const now = stored("notice-1");
    expect(now.version).toBe(4);
    expect(now.title).toBe("고친 제목");
    // 지난 판의 줄은 남지 않는다. 문서를 통째로 갈아 끼운 것이다.
    expect(JSON.stringify(now.sections)).not.toContain("지난 줄");
  });

  it("보낸 문서에 없는 줄은 사라진다", async () => {
    whiff();

    await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                  title: "제목", sections: [{ title: "진행 상황", items: [] }] });

    expect(stored("notice-1").sections[0].items).toEqual([]);
  });

  it("주소가 없는 항목에는 중계 서버가 주소를 붙여 돌려준다", async () => {
    whiff();

    const res = await write({
      slug: "whiffkorea", noticeId: "notice-1", version: 3, title: "제목",
      sections: [{ title: "진행 상황", items: [item(), item({ html: "둘째 줄" })] }],
    });

    const body = await res.json();
    const [a, b] = body.sections[0].items;
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(body.sections[0].id).toBeTruthy();
  });

  it("화면이 대는 주소는 그대로 둔다", async () => {
    whiff();

    const res = await write({
      slug: "whiffkorea", noticeId: "notice-1", version: 3, title: "제목",
      sections: [{ id: "s1", title: "진행 상황", items: [item({ id: "n1" })] }],
    });

    await expect(res.json()).resolves.toMatchObject({
      sections: [{ id: "s1", items: [{ id: "n1" }] }],
    });
  });

  it("같은 주소가 둘이면 422 다", async () => {
    whiff();

    const res = await write({
      slug: "whiffkorea", noticeId: "notice-1", version: 3, title: "제목",
      sections: [{ id: "s1", title: "진행 상황",
                   items: [item({ id: "n1" }), item({ id: "n1" })] }],
    });

    expect(res.status).toBe(422);
    expect(stored("notice-1").version).toBe(3);
  });

  it("하위 항목이 몇 겹이든 그대로 저장한다", async () => {
    whiff();

    const deep = { type: "bullet", html: "하나",
                   items: [{ type: "todo", html: "둘", checked: true,
                             items: [{ type: "quote", html: "셋" }] }] };
    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목", sections: [{ title: "칸", items: [deep] }] });

    const [top] = (await res.json()).sections[0].items;
    expect(top.items[0]).toMatchObject({ type: "todo", html: "둘", checked: true });
    expect(top.items[0].items[0]).toMatchObject({ type: "quote", html: "셋" });
  });

  it("할 일이 아닌 항목에는 체크를 싣지 않는다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목",
                              sections: [{ title: "칸", items: [item({ checked: true })] }] });

    expect((await res.json()).sections[0].items[0].checked).toBeUndefined();
  });

  it("모르는 종류는 422 다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목",
                              sections: [{ title: "칸", items: [item({ type: "table" })] }] });

    expect(res.status).toBe(422);
    expect(stored("notice-1").version).toBe(3);
  });

  it("모르는 태그가 든 글은 422 다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목",
                              sections: [{ title: "칸",
                                           items: [item({ html: "<script>x</script>" })] }] });

    expect(res.status).toBe(422);
    expect(stored("notice-1").version).toBe(3);
  });

  it("노션의 불투명 조각은 받지 않는다", async () => {
    whiff();

    // `data-o` 는 노션 rich_text 의 자리를 가리키는 표다. 저장소에는 짚을
    // 원본이 없으므로 들어올 자리가 아니다.
    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목",
                              sections: [{ title: "칸",
                                           items: [item({ html: '<span data-o="0">멘션</span>' })] }] });

    expect(res.status).toBe(422);
    expect(stored("notice-1").version).toBe(3);
  });

  it("서식은 그대로 실린다", async () => {
    whiff();

    const html = '<strong>굵게</strong> <a href="https://growthhigh.co.kr">링크</a>';
    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목",
                              sections: [{ title: "칸", items: [item({ html })] }] });

    expect((await res.json()).sections[0].items[0].html).toBe(html);
  });

  it("저장 한 번이 재빌드 한 번을 부른다", async () => {
    const { calls } = installNotion();
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목", sections: [section()] });

    await expect(res.json()).resolves.toMatchObject({ rebuild: "sent" });
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("줄이 하나도 없으면 재빌드를 부르지 않는다 — 공지가 통째로 사라진다", async () => {
    const { calls } = installNotion();
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목만 적었다",
                              sections: [{ title: "칸", items: [item({ html: "" })] }] });

    await expect(res.json()).resolves.toMatchObject({ rebuild: "empty" });
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("빈 줄도 받는다 — 담당자가 방금 만든 줄이다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목",
                              sections: [{ title: "칸", items: [item({ html: "" })] }] });

    expect(res.status).toBe(200);
    expect((await res.json()).sections[0].items[0].html).toBe("");
  });
});

describe("판 번호가 어긋나면", () => {
  it("거절하고 지금 문서를 함께 준다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 2,
                              title: "늦게 온 제목", sections: [section()] });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("stale");
    expect(body.current).toMatchObject({
      noticeId: "notice-1", version: 3, title: "2026년 7월 공지",
      sections: [{ id: "s1", items: [{ id: "n1", html: "지난 줄" }] }],
    });
  });

  it("아무것도 쓰지 않는다", async () => {
    whiff();

    await write({ slug: "whiffkorea", noticeId: "notice-1", version: 2,
                  title: "늦게 온 제목", sections: [section()] });

    expect(stored("notice-1")).toMatchObject({ version: 3, title: "2026년 7월 공지" });
  });

  it("판 번호를 빠뜨리면 422 다 — 덮어쓰기로 봐주지 않는다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1",
                              title: "제목", sections: [section()] });

    expect(res.status).toBe(422);
    expect(stored("notice-1").version).toBe(3);
  });
});

describe("남의 기업", () => {
  it("슬러그가 그 공지의 것이 아니면 404 다", async () => {
    whiff();

    const res = await write({ slug: "zeroback", noticeId: "notice-1", version: 3,
                              title: "남의 제목", sections: [section()] });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_mine" });
    expect(stored("notice-1")).toMatchObject({ title: "2026년 7월 공지", version: 3 });
  });

  it("없는 공지 주소는 404 다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "없는-공지", version: 1,
                              title: "제목", sections: [section()] });

    expect(res.status).toBe(404);
    expect(all()).toHaveLength(1);
  });

  it("비밀번호가 없으면 아무것도 쓰지 않는다", async () => {
    whiff();

    const res = await write({ slug: "whiffkorea", noticeId: "notice-1", version: 3,
                              title: "제목", sections: [section()] }, { password: null });

    expect(res.status).toBe(401);
    expect(stored("notice-1").version).toBe(3);
  });
});

describe("저장소가 붙어 있지 않으면", () => {
  it("503 으로 알린다 — 조용히 500 이 되지 않는다", async () => {
    whiff();

    const res = await worker.fetch(new Request("https://relay.test/notice/doc?slug=whiffkorea", {
      headers: { authorization: `Bearer ${b64(good)}` },
    }), ENV);

    expect(res.status).toBe(503);
  });
});
