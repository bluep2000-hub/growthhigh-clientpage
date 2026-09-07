/**
 * 새 공지를 만든다 — `POST /notice/new` 와, 저장에 함께 실리는 제목 고치기.
 *
 * 미팅 직후 기록이 목적이라 날짜를 고르는 창은 없다. 오늘(KST)로 만들고,
 * 필요하면 나중에 노션에서 고친다.
 *
 * 지켜야 하는 것은 넷이다.
 *
 * - 만들 때 **재빌드를 부르지 않는다.** 갓 만든 공지는 비어 있고, 빌더는 빈
 *   공지를 아예 싣지 않는다 — 그대로 내보내면 클라이언트 화면에서 지난
 *   공지가 통째로 사라진다. 담당자가 「저장」을 누를 때 함께 나간다.
 * - 제목 속성은 **이름이 아니라 title 타입으로** 찾는다. 빌더의
 *   `first_title_prop` 과 같은 규칙이다 — 위프코리아 공지 DB 의 제목 속성명은
 *   「상세내용」이다.
 * - 오늘 만들어 둔 **빈 공지가 이미 있으면 또 만들지 않는다.** 같은 날짜 행이
 *   둘이면 빌더가 어느 쪽을 올릴지 정할 수 없고, 담당자는 화면에 뜨지 않는
 *   공지에 적게 된다.
 * - 제목도 **어긋남을 본다.** 기준선은 수정시각이 아니라 제목 글자 자체다 —
 *   페이지의 수정시각은 안에 든 줄을 하나 고쳐도 움직여, 기준선으로 쓰면
 *   제목 저장이 늘 어긋남으로 튕긴다.
 */

import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  EDITED, ENV, ITEM, NESTED, NOTICE_DB, NOTICE_PAGE, OUTSIDER,
  dispatches, installNotion, run, writes,
} from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const good = ENV.EDITOR_PASSWORD;

/** 비밀번호를 빼고 부르려면 `{ password: null }` 을 준다. */
function fresh(body = { slug: "whiffkorea" }, { password = good } = {}) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request("https://relay.test/notice/new", {
    method: "POST", headers, body: JSON.stringify(body),
  }), ENV);
}

function save(body) {
  return worker.fetch(new Request("https://relay.test/notice/save", {
    method: "POST",
    headers: { authorization: `Bearer ${b64(good)}`,
               "content-type": "application/json" },
    body: JSON.stringify({ slug: "whiffkorea", ...body }),
  }), ENV);
}

/** 담당자가 사는 시간대. 중계 서버가 날짜를 매기는 규칙과 같다. */
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 공지 DB 의 한 행. 제목 속성명은 일부러 「상세내용」이다. */
function row(title, date) {
  return { results: [{
    id: NOTICE_PAGE, object: "page", url: `https://www.notion.so/${NOTICE_PAGE}`,
    properties: {
      "상세내용": { type: "title", title: title ? [run(title)] : [] },
      "일자": { type: "date", date: { start: date } },
    },
  }] };
}

/** 노션에 나간 페이지 만들기 요청들. */
const creates = (calls) => calls.filter((c) => c.method === "POST" && c.path === "/pages");

/** 공지 페이지 자체에 쓴 것들. 제목은 여기로 나간다. */
const pageWrites = (calls) => writes(calls).filter((c) => c.path.startsWith("/pages/"));

describe("담당자만 만든다", () => {
  it("비밀번호가 없으면 401, 노션에 닿지 않는다", async () => {
    const { calls } = installNotion();
    const res = await fresh({ slug: "whiffkorea" }, { password: null });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("슬러그가 없으면 422", async () => {
    installNotion();
    expect((await fresh({})).status).toBe(422);
  });

  it("모르는 슬러그면 404", async () => {
    installNotion({ share: { results: [] } });
    expect((await fresh({ slug: "없는기업" })).status).toBe(404);
  });
});

describe("오늘 날짜로 공지 DB 에 행을 만든다", () => {
  it("만든 페이지의 주소를 돌려준다", async () => {
    const { calls } = installNotion();
    const res = await fresh();

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.date).toBe(todayKst());
    expect(body.pageId).toBeTruthy();
    expect(body.pageId).not.toBe(NOTICE_PAGE);
    expect(body.page_url).toContain(body.pageId);

    const [made] = creates(calls);
    expect(made.body.parent).toEqual({ database_id: NOTICE_DB });
    expect(made.body.properties["일자"]).toEqual({ date: { start: todayKst() } });
  });

  it("제목은 비운 채로 만든다 — 커서가 갈 자리다", async () => {
    const { calls } = installNotion();
    await fresh();

    // 이름이 아니라 title 타입으로 찾는다. 위프코리아는 「상세내용」이다.
    expect(creates(calls)[0].body.properties["상세내용"]).toEqual({ title: [] });
  });

  it("재빌드를 부르지 않는다 — 빈 공지를 내보내면 지난 공지가 사라진다", async () => {
    const { calls } = installNotion();
    await fresh();

    expect(dispatches(calls)).toHaveLength(0);
  });

  it("공지 원천이 일반 페이지면 만들지 않는다 — 행을 만들 곳이 없다", async () => {
    const { calls } = installNotion({ noticeIsPage: true });
    const res = await fresh();

    expect(res.status).toBe(422);
    expect(creates(calls)).toHaveLength(0);
  });
});

describe("오늘 날짜 공지가 이미 있으면 또 만들지 않는다", () => {
  it("그 공지를 그대로 돌려준다", async () => {
    const { calls } = installNotion({ blocks: {}, notice: row("", todayKst()) });
    const res = await fresh();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageId).toBe(NOTICE_PAGE);
    expect(body.existing).toBe(true);
    expect(creates(calls)).toHaveLength(0);
  });

  it("내용이 이미 있어도 만들지 않는다 — 같은 날짜 둘은 승자가 임의다", async () => {
    const { calls } = installNotion({ notice: row("아침 회의", todayKst()) });
    const res = await fresh();

    expect(res.status).toBe(200);
    expect((await res.json()).existing).toBe(true);
    expect(creates(calls)).toHaveLength(0);
  });

  it("어제 공지가 비어 있어도 새로 만든다 — 오늘 것이 아니다", async () => {
    const { calls } = installNotion({ blocks: {}, notice: row("", "2026-07-31") });
    const res = await fresh();

    expect(res.status).toBe(201);
    expect(creates(calls)).toHaveLength(1);
  });

  it("공지가 하나도 없는 기업에도 만들어 준다 — 첫 공지가 여기서 난다", async () => {
    const { calls } = installNotion({ blocks: {}, notice: { results: [] } });
    const res = await fresh();

    expect(res.status).toBe(201);
    expect(creates(calls)).toHaveLength(1);
  });
});

describe("편집 모드가 지금 제목을 받아 간다", () => {
  it("GET /notice/tree 가 제목을 함께 준다", async () => {
    installNotion({ notice: row("2026년 7월 공지", "2026-07-31") });
    const res = await worker.fetch(new Request(
      "https://relay.test/notice/tree?slug=whiffkorea",
      { headers: { authorization: `Bearer ${b64(good)}` } }), ENV);

    expect((await res.json()).title).toBe("2026년 7월 공지");
  });
});

describe("제목은 저장에 함께 실린다", () => {
  const title = (text, seen = "2026년 7월 공지") => ({ op: "title", text, seen });
  const dated = () => installNotion({ notice: row("2026년 7월 공지", "2026-07-31") });

  it("노션의 제목 속성을 갈아 끼운다", async () => {
    const { calls } = dated();
    const res = await save({ changes: [title("2026년 9월 공지")] });

    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.results[0]).toMatchObject({ index: 0, status: "ok", title: "2026년 9월 공지" });

    const [patch] = pageWrites(calls);
    expect(patch.body.properties["상세내용"].title[0].text.content).toBe("2026년 9월 공지");
  });

  it("제목만 바뀌어도 재빌드 신호가 나간다", async () => {
    const { calls } = dated();
    await save({ changes: [title("2026년 9월 공지")] });

    expect(dispatches(calls)).toHaveLength(1);
  });

  /**
   * 갓 만든 공지에 제목만 적고 저장했을 때다. 빌더는 줄이 하나도 없는 공지를
   * 아예 싣지 않으므로(`fetch_notice` 의 「읽을 내용이 없습니다」) 신호를
   * 던지면 그 기업의 공지가 화면에서 통째로 사라진다 — 지난 공지까지 함께다.
   * 게다가 화면은 공지가 사라지면 편집 모드조차 다시 열지 못한다.
   */
  it("줄이 하나도 없는 공지는 저장해도 재빌드를 부르지 않는다", async () => {
    const { calls } = installNotion({ blocks: {}, notice: row("", "2026-07-31") });
    const res = await save({ changes: [{ op: "title", text: "9월 1주 미팅", seen: "" }] });

    const body = await res.json();
    expect(body.saved).toBe(1);          // 노션에는 들어갔다
    expect(body.rebuild).toBe("empty");  // 화면에 낼 것이 아직 없다
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("한 줄이라도 보태면 그때 신호가 나간다", async () => {
    const { calls } = installNotion({ blocks: {}, notice: row("", "2026-07-31") });
    const res = await save({ changes: [
      { op: "title", text: "9월 1주 미팅", seen: "" },
      { op: "add", tempId: "n1", html: "사업계획서 초안 공유" },
    ] });

    expect((await res.json()).rebuild).toBe("sent");
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("그 사이에 노션에서 먼저 바뀌었으면 쓰지 않는다", async () => {
    const { calls } = installNotion({ notice: row("남이 고친 제목", "2026-07-31") });
    const res = await save({ changes: [title("2026년 9월 공지")] });

    const body = await res.json();
    expect(body.saved).toBe(0);
    expect(body.results[0]).toMatchObject({ index: 0, status: "stale" });
    // 노션의 지금 제목을 함께 준다. 어느 쪽을 남길지는 담당자가 고른다.
    expect(body.results[0].current.title).toBe("남이 고친 제목");
    expect(pageWrites(calls)).toHaveLength(0);
  });

  it("seen 이 없으면 그 변경만 실패한다", async () => {
    const { calls } = dated();
    const res = await save({ changes: [{ op: "title", text: "새 제목" }] });

    expect((await res.json()).results[0].status).toBe("failed");
    expect(pageWrites(calls)).toHaveLength(0);
  });

  it("text 가 글자가 아니면 그 변경만 실패한다", async () => {
    const { calls } = dated();
    const res = await save({ changes: [{ op: "title", text: 7, seen: "2026년 7월 공지" }] });

    expect((await res.json()).results[0].status).toBe("failed");
    expect(pageWrites(calls)).toHaveLength(0);
  });

  it("제목을 맨 먼저 쓴다 — 제목 → 고침 → 보탬 → 지움", async () => {
    const { calls } = dated();
    // 보낸 차례를 일부러 거꾸로 한다. 그래도 쓰는 차례는 종류대로여야 한다.
    await save({ changes: [
      { op: "remove", blockId: NESTED, seen: EDITED },
      { op: "add", tempId: "n1", html: "보탠 줄" },
      { op: "edit", blockId: ITEM, seen: EDITED, html: "고친 글" },
      title("2026년 9월 공지"),
    ] });

    const kinds = writes(calls).map((c) => (
      c.method === "DELETE" ? "지움"
      : c.path.startsWith("/pages/") ? "제목"
      : c.path.endsWith("/children") ? "보탬" : "고침"));
    expect(kinds).toEqual(["제목", "고침", "보탬", "지움"]);
  });

  it("남의 기업 공지에는 손대지 못한다 — 슬러그가 정한 공지에만 쓴다", async () => {
    const { calls } = dated();
    const res = await save({ noticePageId: OUTSIDER, changes: [title("새 제목")] });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });
});
