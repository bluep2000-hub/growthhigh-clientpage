/**
 * `POST /notice/save` — 고친 것을 한 번에 노션에 보내는 창구.
 *
 * 여기서 지켜야 하는 것은 넷이다.
 *
 * - 하나가 실패해도 나머지는 간다. 전부 취소인 척하지 않는다 — 노션에
 *   되돌리기가 없어 거짓말이 된다.
 * - 화면이 본 뒤에 노션에서 먼저 바뀐 항목은 **쓰지 않는다.**
 * - 남의 기업 블록 주소가 섞여 오면 **아무것도 쓰지 않고** 통째로 거절한다.
 * - 한 번의 저장이 재빌드 신호를 한 번만 던지고, 아무것도 못 썼으면 안 던진다.
 */

import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  EDITED, ENV, ITEM, NESTED, NOTICE_PAGE, OTHER_PAGE, OUTSIDER,
  block, dispatches, inPage, installNotion, run, world, writes,
} from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const good = ENV.EDITOR_PASSWORD;

/** 비밀번호를 빼고 부르려면 `{ password: null }` 을 준다. */
function save(body, { password = good } = {}) {
  const headers = { "content-type": "application/json" };
  if (password !== null) headers.authorization = `Bearer ${b64(password)}`;
  return worker.fetch(new Request("https://relay.test/notice/save", {
    method: "POST", headers, body: JSON.stringify(body),
  }), ENV);
}

const edit = (blockId, html, seen = EDITED) => ({ op: "edit", blockId, seen, html });
const check = (blockId, checked, seen = EDITED) => ({ op: "check", blockId, seen, checked });

/** 노션에 나간 rich_text. 어느 블록에 무엇을 썼는지 견줄 때 쓴다. */
function patchedRuns(calls, blockId) {
  const hit = calls.find((c) => c.method === "PATCH" && c.path === `/blocks/${blockId}`);
  return hit && Object.values(hit.body)[0].rich_text;
}

describe("담당자만 저장한다", () => {
  it("비밀번호가 없으면 401, 노션에 닿지 않는다", async () => {
    const { calls } = installNotion();
    const res = await save({ slug: "whiffkorea", changes: [edit(ITEM, "새 글")] },
                           { password: null });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("changes 가 비어 있으면 422", async () => {
    installNotion();
    expect((await save({ slug: "whiffkorea", changes: [] })).status).toBe(422);
  });

  it("한 번에 보낼 수 있는 수를 넘기면 422, 아무것도 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const many = Array.from({ length: 21 }, () => edit(ITEM, "글"));
    const res = await save({ slug: "whiffkorea", changes: many });

    expect(res.status).toBe(422);
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("고치기와 체크를 목록으로 받아 하나씩 적용한다", () => {
  it("고친 글이 노션에 들어가고 결과가 돌아온다", async () => {
    const { calls } = installNotion();
    const res = await save({ slug: "whiffkorea",
                             changes: [edit(ITEM, "<strong>새</strong> 글")] });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results[0]).toMatchObject({ index: 0, blockId: ITEM, status: "ok" });
    expect(body.results[0].html).toBe("<strong>새</strong> 글");

    expect(patchedRuns(calls, ITEM)).toEqual([
      { type: "text", text: { content: "새", link: null },
        annotations: { bold: true, italic: false, strikethrough: false,
                       underline: false, code: false, color: "default" } },
      { type: "text", text: { content: " 글", link: null },
        annotations: { bold: false, italic: false, strikethrough: false,
                       underline: false, code: false, color: "default" } },
    ]);
  });

  it("저장 뒤 결과에 새 기준선이 실려 온다 — 이어서 또 저장할 수 있다", async () => {
    installNotion();
    const first = await (await save({ slug: "whiffkorea",
                                      changes: [edit(ITEM, "한 번")] })).json();
    const next = first.results[0].last_edited_time;
    expect(next).not.toBe(EDITED);

    const second = await (await save({
      slug: "whiffkorea", changes: [edit(ITEM, "두 번", next)] })).json();
    expect(second.results[0].status).toBe("ok");
  });

  it("체크는 글을 건드리지 않는다", async () => {
    const { calls, blocks } = installNotion({ blocks: {
      [ITEM]: block(ITEM, "to_do", [run("현장실사")], inPage(NOTICE_PAGE),
                    { to_do: { rich_text: [run("현장실사")], checked: false } }),
    } });
    const res = await save({ slug: "whiffkorea", changes: [check(ITEM, true)] });

    expect((await res.json()).results[0]).toMatchObject({ status: "ok", checked: true });
    expect(blocks[ITEM].to_do.checked).toBe(true);
    expect(blocks[ITEM].to_do.rich_text[0].plain_text).toBe("현장실사");
    const sent = calls.find((c) => c.method === "PATCH" && c.path === `/blocks/${ITEM}`);
    expect(sent.body).toEqual({ to_do: { checked: true } });
  });

  it("할 일이 아닌 항목에 체크를 보내면 그 변경만 실패한다", async () => {
    installNotion();
    const body = await (await save({ slug: "whiffkorea",
                                     changes: [check(ITEM, true)] })).json();

    expect(body.results[0].status).toBe("failed");
    expect(body.saved).toBe(0);
  });
});

describe("글자색과 커스텀 이모지는 고쳐 저장해도 남는다", () => {
  const emoji = { type: "mention", mention: { type: "custom_emoji",
                                              custom_emoji: { id: "e-1", name: "도장" } },
                  annotations: { bold: false, italic: false, strikethrough: false,
                                 underline: false, code: false, color: "default" },
                  plain_text: ":도장:", href: null };

  it("색이 칠해진 글을 고쳐도 색이 그대로 노션에 간다", async () => {
    const { calls } = installNotion({ blocks: {
      [ITEM]: block(ITEM, "paragraph", [run("빨강", { color: "red" })], inPage(NOTICE_PAGE)),
    } });
    await save({ slug: "whiffkorea",
                 changes: [edit(ITEM, '<span data-c="red">빨강 고침</span>')] });

    expect(patchedRuns(calls, ITEM)).toEqual([
      { type: "text", text: { content: "빨강 고침", link: null },
        annotations: { bold: false, italic: false, strikethrough: false,
                       underline: false, code: false, color: "red" } },
    ]);
  });

  it("이모지가 든 항목의 글만 고쳐도 이모지가 그대로 간다", async () => {
    const { calls } = installNotion({ blocks: {
      [ITEM]: block(ITEM, "paragraph", [emoji, run(" 접수 완료")], inPage(NOTICE_PAGE)),
    } });
    const res = await save({ slug: "whiffkorea",
                             changes: [edit(ITEM, '<span data-o="0">:도장:</span> 접수 반려')] });

    expect((await res.json()).results[0].status).toBe("ok");
    expect(patchedRuns(calls, ITEM)[0]).toEqual({
      type: "mention", mention: { type: "custom_emoji", custom_emoji: { id: "e-1" } },
      annotations: { bold: false, italic: false, strikethrough: false,
                     underline: false, code: false, color: "default" },
    });
  });

  it("불투명 조각의 글자를 바꿔 보내면 거절하고 쓰지 않는다", async () => {
    const { calls } = installNotion({ blocks: {
      [ITEM]: block(ITEM, "paragraph", [emoji, run(" 접수")], inPage(NOTICE_PAGE)),
    } });
    const res = await save({ slug: "whiffkorea",
                             changes: [edit(ITEM, '<span data-o="0">:다른이모지:</span> 접수')] });

    expect((await res.json()).results[0]).toMatchObject({ status: "failed" });
    expect(writes(calls)).toHaveLength(0);
  });

  it("없는 자리를 가리키는 불투명 조각도 거절한다", async () => {
    const { calls } = installNotion({ blocks: {
      [ITEM]: block(ITEM, "paragraph", [emoji], inPage(NOTICE_PAGE)),
    } });
    const res = await save({ slug: "whiffkorea",
                             changes: [edit(ITEM, '<span data-o="7">:도장:</span>')] });

    expect((await res.json()).results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("모르는 서식은 받지 않는다", () => {
  it.each([
    ["모르는 태그", "<script>나쁜 것</script>"],
    ["닫히지 않은 태그", "<strong>덜 닫힘"],
    ["엇갈린 태그", "<strong><em>엇갈림</strong></em>"],
    ["위험한 주소", '<a href="javascript:alert(1)">누르지 마시오</a>'],
    ["모르는 색", '<span data-c="무지개">색</span>'],
    ["빈 내용", ""],
  ])("%s 은 그 변경만 실패하고 노션에 나가지 않는다", async (_name, html) => {
    const { calls } = installNotion();
    const res = await save({ slug: "whiffkorea", changes: [edit(ITEM, html)] });

    expect((await res.json()).results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("잠긴 항목", () => {
  const card = { type: "mention", mention: { type: "link_mention", link_mention: { id: "lm" } },
                 annotations: { bold: false, italic: false, strikethrough: false,
                                underline: false, code: false, color: "default" },
                 plain_text: "https://example.com/x", href: null };

  it("링크 카드가 든 항목은 고치지 못한다", async () => {
    const { calls } = installNotion({ blocks: {
      [ITEM]: block(ITEM, "paragraph", [run("공고 "), card], inPage(NOTICE_PAGE)),
    } });
    const body = await (await save({ slug: "whiffkorea",
                                     changes: [edit(ITEM, "덮어쓰기")] })).json();

    expect(body.results[0]).toMatchObject({ status: "locked", detail: "링크 카드" });
    expect(writes(calls)).toHaveLength(0);
  });

  it("잠긴 항목이라도 체크는 된다", async () => {
    installNotion({ blocks: {
      [ITEM]: block(ITEM, "to_do", [run("공고 "), card], inPage(NOTICE_PAGE),
                    { to_do: { rich_text: [run("공고 "), card], checked: false } }),
    } });
    const body = await (await save({ slug: "whiffkorea",
                                     changes: [check(ITEM, true)] })).json();

    expect(body.results[0].status).toBe("ok");
  });
});

describe("어긋난 항목", () => {
  it("화면이 본 시각이 다르면 쓰지 않고 노션의 지금 내용을 준다", async () => {
    const { calls } = installNotion();
    const body = await (await save({
      slug: "whiffkorea",
      changes: [edit(ITEM, "덮어쓰기", "2020-01-01T00:00:00.000Z")] })).json();

    expect(body.results[0]).toMatchObject({ status: "stale", blockId: ITEM });
    expect(body.results[0].current).toMatchObject({
      type: "bulleted_list_item",
      last_edited_time: EDITED,
      html: "연구주제 : 패키지 디자인 개발",
    });
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("어긋난 항목 하나가 나머지 저장을 막지 않는다", async () => {
    installNotion();
    const body = await (await save({ slug: "whiffkorea", changes: [
      edit(ITEM, "덮어쓰기", "2020-01-01T00:00:00.000Z"),
      edit(NESTED, "나는 된다"),
    ] })).json();

    expect(body.results.map((r) => r.status)).toEqual(["stale", "ok"]);
    expect(body.saved).toBe(1);
    expect(body.failed).toBe(1);
  });
});

describe("부분 실패를 정직하게 드러낸다", () => {
  it("다섯 중 셋째가 실패해도 넷째·다섯째가 적용된다", async () => {
    const blocks = {};
    for (let i = 0; i < 5; i += 1) {
      blocks[`줄-${i}`] = block(`줄-${i}`, "bulleted_list_item",
                                [run(`${i}번`)], inPage(NOTICE_PAGE));
    }
    const { calls } = installNotion({ blocks });

    const body = await (await save({ slug: "whiffkorea", changes: [
      edit("줄-0", "0 고침"), edit("줄-1", "1 고침"),
      edit("줄-2", "<strong>닫히지 않음"),
      edit("줄-3", "3 고침"), edit("줄-4", "4 고침"),
    ] })).json();

    expect(body.results.map((r) => r.status))
      .toEqual(["ok", "ok", "failed", "ok", "ok"]);
    expect(body.results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(body.saved).toBe(4);
    expect(body.failed).toBe(1);
    expect(patchedRuns(calls, "줄-2")).toBeUndefined();
  });
});

describe("남의 것은 건드리지 않는다", () => {
  it("남의 기업 블록 주소를 섞어 보내면 통째로 거절하고 아무것도 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const res = await save({ slug: "whiffkorea", changes: [
      edit(ITEM, "내 것"), edit(OUTSIDER, "남의 것"), edit(NESTED, "내 것 2"),
    ] });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_mine" });
    expect(writes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("화면이 보던 공지가 더 이상 가장 최근이 아니면 거절한다", async () => {
    const { calls } = installNotion();
    const res = await save({ slug: "whiffkorea", noticePageId: OTHER_PAGE,
                             changes: [edit(ITEM, "새 글")] });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });

  it("모르는 슬러그면 404", async () => {
    installNotion({ share: { results: [] } });
    const res = await save({ slug: "없는기업", changes: [edit(ITEM, "글")] });
    expect(res.status).toBe(404);
  });
});

describe("한 번의 저장이 재빌드 한 번", () => {
  it("변경이 여럿이어도 신호는 한 번", async () => {
    const { calls } = installNotion();
    await save({ slug: "whiffkorea",
                 changes: [edit(ITEM, "하나"), edit(NESTED, "둘")] });

    const sent = dispatches(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ event_type: "rebuild",
                                         client_payload: { slug: "whiffkorea" } });
  });

  it("아무것도 성공하지 못했으면 신호를 던지지 않는다", async () => {
    const { calls } = installNotion();
    const body = await (await save({ slug: "whiffkorea", changes: [
      edit(ITEM, "<strong>닫히지 않음"), edit(NESTED, "<script>x</script>"),
    ] })).json();

    expect(body.saved).toBe(0);
    expect(body.rebuild).toBe("skipped");
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("신호가 실패해도 저장은 성공이다", async () => {
    installNotion({ dispatchFails: true });
    const body = await (await save({ slug: "whiffkorea",
                                     changes: [edit(ITEM, "새 글")] })).json();

    expect(body.saved).toBe(1);
    expect(body.rebuild).toBe("failed");
  });
});

describe("공지에 날짜를 채운다", () => {
  it("일자가 비어 있으면 저장하면서 오늘로 채운다", async () => {
    const { calls } = installNotion({ notice: { results: [
      { id: NOTICE_PAGE, object: "page", properties: { "일자": { type: "date", date: null } } },
    ] } });
    await save({ slug: "whiffkorea", changes: [edit(ITEM, "새 글")] });

    const dated = calls.find((c) => c.method === "PATCH" && c.path === `/pages/${NOTICE_PAGE}`);
    expect(dated.body.properties["일자"].date.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("아무것도 못 썼으면 날짜도 건드리지 않는다", async () => {
    const { calls } = installNotion({ notice: { results: [
      { id: NOTICE_PAGE, object: "page", properties: { "일자": { type: "date", date: null } } },
    ] } });
    await save({ slug: "whiffkorea", changes: [edit(ITEM, "<strong>닫히지 않음")] });

    expect(calls.find((c) => c.path === `/pages/${NOTICE_PAGE}`)).toBeUndefined();
  });
});
