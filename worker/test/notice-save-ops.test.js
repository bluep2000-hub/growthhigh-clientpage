/**
 * `POST /notice/save` 의 보태기·지우기 — 고치기와 같은 저장에 함께 실린다.
 *
 * 저장 한 번이 재빌드 한 번이다. 보태기와 지우기가 따로 나가면 담당자가
 * 미팅 뒤에 세 줄 손볼 때마다 클라이언트 화면이 몇 분씩 흔들린다.
 *
 * 여기서 지켜야 하는 것은 넷이다.
 *
 * - 보탠 줄은 **화면에서 놓은 자리**에 들어간다. 노션은 블록을 옮기지 못해
 *   맨 끝에 붙였다가 끌어 올리는 길이 없다(ADR 0003).
 * - 같은 저장 안에서 방금 보탠 줄에 이어 또 보탤 수 있다. 화면에서 Enter 를
 *   여러 번 치면 그렇게 된다.
 * - 쓰는 차례는 종류가 정한다 — 고침 → 보탬 → 지움. 지우기가 맨 뒤인 것이
 *   값을 치른다: 지울 줄을 발판 삼아 보탠 줄이 있으면 먼저 지우는 순간
 *   그 발판이 사라진다.
 * - 지우기도 **어긋남을 본다.** ✕ 를 누른 뒤 저장하기까지 몇 분이 흐르고,
 *   그 사이에 다른 담당자가 그 줄을 새로 썼으면 지우기는 그것을 가져간다.
 * - 잠긴 줄도 **지우기는 된다.** 잘못 붙인 링크 카드 하나 때문에 노션을
 *   열게 하지 않는다.
 */

import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  EDITED, ENV, ITEM, NESTED, NOTICE_PAGE, OTHER_PAGE, OUTSIDER,
  block, dispatches, inBlock, inPage, installNotion, run, world, writes,
} from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function save(body) {
  return worker.fetch(new Request("https://relay.test/notice/save", {
    method: "POST",
    headers: { authorization: `Bearer ${b64(ENV.EDITOR_PASSWORD)}`,
               "content-type": "application/json" },
    body: JSON.stringify({ slug: "whiffkorea", ...body }),
  }), ENV);
}

const add = (tempId, html, where = {}) => ({ op: "add", tempId, html, ...where });
const remove = (blockId, seen = EDITED) => ({ op: "remove", blockId, seen });
const edit = (blockId, html) => ({ op: "edit", blockId, seen: EDITED, html });

/** 노션에 나간 붙이기 요청들. 어느 그릇에 어느 자리로 갔는지가 여기 있다. */
const appends = (calls) => calls.filter(
  (c) => c.method === "PATCH" && c.path.endsWith("/children"));

/** 지우기 요청들. */
const deletes = (calls) => calls.filter((c) => c.method === "DELETE");

const HEADING = "heading-block-1";
const IMAGE = "image-block-1";

/**
 * 머리말 자리의 그림 한 줄, 그 뒤에 제목 하나와 그 아래 두 줄.
 *
 * 꽂은 차례가 곧 노션의 차례다. 그림을 제목 앞에 두어야 「진행 사항」 섹션이
 * 가1·가2 로 끝난다 — 뒤에 두면 그림도 그 섹션의 마지막 줄이 된다.
 */
function sectioned() {
  return world({
    [IMAGE]: { object: "block", id: IMAGE, type: "image", parent: inPage(NOTICE_PAGE),
               last_edited_time: EDITED, image: { type: "external", external: { url: "x" } } },
    [HEADING]: { object: "block", id: HEADING, type: "heading_2", parent: inPage(NOTICE_PAGE),
                 last_edited_time: EDITED, heading_2: { rich_text: [run("진행 사항")] } },
    "가1": block("가1", "bulleted_list_item", [run("서류 접수")], inPage(NOTICE_PAGE)),
    "가2": block("가2", "bulleted_list_item", [run("현장 실사")], inPage(NOTICE_PAGE)),
  });
}

describe("보탠 줄이 화면에서 놓은 자리에 들어간다", () => {
  it("앵커가 없으면 공지 맨 끝이다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [add("n1", "미팅에서 나온 한 줄")] });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.results[0]).toMatchObject({ index: 0, tempId: "n1", status: "ok" });
    expect(body.results[0].blockId).toBeTruthy();
    expect(body.results[0].html).toBe("미팅에서 나온 한 줄");

    const [put] = appends(calls);
    expect(put.path).toBe(`/blocks/${NOTICE_PAGE}/children`);
    expect(put.body.position).toBeUndefined();
    expect(put.body.children[0].type).toBe("bulleted_list_item");
  });

  it("`after` 로 짚은 줄의 바로 다음 형제가 된다", async () => {
    const { calls } = installNotion();
    await save({ changes: [add("n1", "새 줄", { after: ITEM })] });

    const [put] = appends(calls);
    expect(put.path).toBe(`/blocks/${NOTICE_PAGE}/children`);
    expect(put.body.position).toEqual({ type: "after_block", after_block: { id: ITEM } });
  });

  it("한 겹 안쪽 줄에 이어 붙이면 그 그릇 안에 남는다", async () => {
    const { calls } = installNotion();
    await save({ changes: [add("n1", "새 줄", { after: NESTED })] });

    // NESTED 의 부모는 ITEM 이다. 페이지 밑에 붙이면 화면에서 한 칸 튀어나온다.
    const [put] = appends(calls);
    expect(put.path).toBe(`/blocks/${ITEM}/children`);
    expect(put.body.position).toEqual({ type: "after_block", after_block: { id: NESTED } });
  });

  it("방금 보탠 줄에 이어 또 보탠다 — Enter 를 두 번 친 경우다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [
      add("n1", "첫 줄", { after: ITEM }),
      add("n2", "둘째 줄", { afterNew: "n1" }),
    ] });

    const body = await res.json();
    expect(body.saved).toBe(2);
    const first = body.results[0].blockId;

    const [one, two] = appends(calls);
    expect(one.body.position.after_block.id).toBe(ITEM);
    expect(two.path).toBe(one.path);                     // 같은 그릇
    expect(two.body.position).toEqual({ type: "after_block", after_block: { id: first } });
  });

  it("`sectionId` 로 주면 그 섹션 끝이다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    await save({ changes: [add("n1", "새 줄", { sectionId: HEADING })] });

    const [put] = appends(calls);
    expect(put.body.position).toEqual({ type: "after_block", after_block: { id: "가2" } });
  });

  it("빈 줄은 그 줄만 실패하고 나머지는 간다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [add("n1", ""), add("n2", "쓴 줄")] });

    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results[0]).toMatchObject({ index: 0, tempId: "n1", status: "failed" });
    expect(body.results[1]).toMatchObject({ index: 1, tempId: "n2", status: "ok" });
    expect(appends(calls)).toHaveLength(1);
  });

  it("모르는 `afterNew` 는 그 줄만 실패한다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [add("n1", "새 줄", { afterNew: "없는것" })] });

    const body = await res.json();
    expect(body.saved).toBe(0);
    expect(body.results[0].status).toBe("failed");
    expect(appends(calls)).toHaveLength(0);
  });

  it("tempId 가 겹치면 뒤엣것만 실패한다 — 화면이 주소를 못 가린다", async () => {
    installNotion();
    const res = await save({ changes: [add("n1", "가"), add("n1", "나")] });

    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.results[1].status).toBe("failed");
  });

  it("남의 기업 줄을 앵커로 주면 통째로 거절하고 아무것도 쓰지 않는다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [
      edit(ITEM, "고친 글"),
      add("n1", "새 줄", { after: OUTSIDER }),
    ] });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_mine");
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("지우기", () => {
  it("지우면 노션에서 사라지고 결과가 돌아온다", async () => {
    const { calls, blocks } = installNotion();
    const res = await save({ changes: [remove(NESTED)] });

    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.results[0]).toMatchObject({ index: 0, blockId: NESTED,
                                            status: "ok", removed: true });
    expect(deletes(calls).map((c) => c.path)).toEqual([`/blocks/${NESTED}`]);
    expect(blocks[NESTED]).toBeUndefined();
  });

  it("잠긴 줄도 지운다 — 그림 한 줄 때문에 노션을 열게 하지 않는다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    const res = await save({ changes: [remove(IMAGE)] });

    expect((await res.json()).saved).toBe(1);
    expect(deletes(calls).map((c) => c.path)).toEqual([`/blocks/${IMAGE}`]);
  });

  it("섹션 제목은 지우지 않는다 — 섹션이 통째로 남의 것과 합쳐진다", async () => {
    const { calls } = installNotion({ blocks: sectioned() });
    const res = await save({ changes: [remove(HEADING)] });

    const body = await res.json();
    expect(body.saved).toBe(0);
    expect(body.results[0].status).toBe("failed");
    expect(deletes(calls)).toHaveLength(0);
  });

  it("화면이 본 뒤에 노션에서 먼저 바뀌었으면 지우지 않는다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [remove(NESTED, "2026-09-05T00:00:00.000Z")] });

    const body = await res.json();
    expect(body.saved).toBe(0);
    expect(body.results[0]).toMatchObject({ index: 0, blockId: NESTED, status: "stale" });
    // 노션의 지금 내용을 함께 준다. 어느 쪽을 남길지는 담당자가 고른다.
    expect(body.results[0].current.html).toBe("현장실사 완료");
    expect(deletes(calls)).toHaveLength(0);
  });

  it("어긋난 줄 하나가 나머지 지우기를 막지는 않는다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [
      remove(NESTED, "2026-09-05T00:00:00.000Z"), remove(ITEM),
    ] });

    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(deletes(calls).map((c) => c.path)).toEqual([`/blocks/${ITEM}`]);
  });

  it("seen 이 없으면 그 줄만 실패한다 — 못 읽은 줄을 눈감고 지우지 않는다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [{ op: "remove", blockId: NESTED }] });

    const body = await res.json();
    expect(body.saved).toBe(0);
    expect(body.results[0].status).toBe("failed");
    expect(deletes(calls)).toHaveLength(0);
  });

  it("이미 지운 줄은 그 줄만 실패한다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [remove("없는-주소"), remove(NESTED)] });

    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.results[0].status).toBe("failed");
    expect(deletes(calls)).toHaveLength(1);
  });

  it("남의 기업 줄이 섞이면 통째로 거절한다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [remove(NESTED), remove(OUTSIDER)] });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("보태기와 지우기가 한 저장에 함께 실린다", () => {
  it("지울 줄을 발판 삼아 보태도 보탠 줄이 그 자리에 들어간다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [remove(ITEM), add("n1", "새 줄", { after: ITEM })] });

    const body = await res.json();
    expect(body.saved).toBe(2);
    // 붙이기가 먼저다. 먼저 지우면 그 자리를 짚을 수 없다.
    const order = writes(calls).map((c) => c.method);
    expect(order.indexOf("PATCH")).toBeLessThan(order.indexOf("DELETE"));
    expect(appends(calls)[0].body.position.after_block.id).toBe(ITEM);
  });

  it("쓰는 차례는 종류가 정한다 — 고침 → 보탬 → 지움", async () => {
    const { calls } = installNotion();
    // 보낸 차례를 일부러 거꾸로 한다. 그래도 쓰는 차례는 종류대로여야 한다.
    await save({ changes: [
      remove(NESTED), add("n1", "보탠 줄"), edit(ITEM, "고친 글"),
    ] });

    const kinds = writes(calls).map(
      (c) => (c.method === "DELETE" ? "지움" : c.path.endsWith("/children") ? "보탬" : "고침"));
    expect(kinds).toEqual(["고침", "보탬", "지움"]);
  });

  it("고치기·보태기·지우기가 섞여도 재빌드 신호는 한 번이다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [
      edit(ITEM, "고친 글"), add("n1", "보탠 줄"), remove(NESTED),
    ] });

    const body = await res.json();
    expect(body.saved).toBe(3);
    expect(body.failed).toBe(0);
    expect(body.rebuild).toBe("sent");
    expect(dispatches(calls)).toHaveLength(1);
    // 결과는 보낸 차례 그대로 돌려준다 — 화면이 순서로 짚는다.
    expect(body.results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(body.results[2].removed).toBe(true);
  });

  it("아무것도 못 썼으면 재빌드 신호를 던지지 않는다", async () => {
    const { calls } = installNotion();
    const res = await save({ changes: [add("n1", "")] });

    expect((await res.json()).rebuild).toBe("skipped");
    expect(dispatches(calls)).toHaveLength(0);
  });
});
