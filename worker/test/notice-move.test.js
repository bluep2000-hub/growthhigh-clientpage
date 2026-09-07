/**
 * `POST /notice/save` 의 옮기기와 종류 바꾸기.
 *
 * 노션 API 에는 **블록을 옮기는 창구도, 종류를 바꾸는 창구도 없다.** 둘 다
 * 지우고 다시 만드는 수밖에 없고, 그러면 그 줄의 주소가 바뀐다. 그래서 이
 * 파일이 지키는 것은 넷이다.
 *
 * - **안전 판정을 먼저 한다.** 안에 든 줄이 있거나 잠긴 줄은 노션에 한 글자도
 *   나가기 전에 `locked` 로 돌아온다. 화면도 그런 줄에는 ↑↓ 를 그리지 않지만,
 *   서버 판정은 화면을 믿지 않기 위한 이중 확인이다.
 * - **만들고 나서 지운다.** 지우기가 먼저면 붙이기가 실패하는 순간 그 줄이
 *   노션에서 사라진다 — 되돌리기는 없다.
 * - **새 주소를 돌려준다.** 화면이 주소를 갈아 끼우지 못하면 그 다음 저장이
 *   없는 블록을 가리킨다.
 * - **자리는 방향이 아니라 이웃으로 짚는다.** 화면의 한 칸과 노션의 한 칸이
 *   같지 않다 — 빌더가 콜아웃을 펴서 그리고, 제목은 화면의 줄이 아니다.
 *   화면이 「이 줄 다음」을 짚어 보내면 그 어긋남이 아예 생기지 않는다.
 */

import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  EDITED, ENV, ITEM, NESTED, NOTICE_PAGE, OUTSIDER,
  block, dispatches, inBlock, inPage, installNotion, run, world, writes,
} from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function save(body, auth = `Bearer ${b64(ENV.EDITOR_PASSWORD)}`) {
  return worker.fetch(new Request("https://relay.test/notice/save", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ slug: "whiffkorea", ...body }),
  }), ENV);
}

const move = (blockId, spot, seen = EDITED) => ({ op: "move", blockId, seen, ...spot });
const retype = (blockId, type, seen = EDITED) => ({ op: "retype", blockId, seen, type });

const appends = (calls) => calls.filter(
  (c) => c.method === "PATCH" && c.path.endsWith("/children"));
const deletes = (calls) => calls.filter((c) => c.method === "DELETE");

const HEADING = "sec-heading";
const LOCKED = "row-locked";

/**
 * 제목 하나와 그 아래 세 줄. 꽂은 차례가 곧 노션의 차례다.
 *
 * `world()` 가 먼저 꽂는 ITEM 이 맨 위에 온다 — 그것은 안에 든 줄(NESTED)이
 * 있어 옮길 수 없는 줄이고, 여기서는 그 자리로 쓴다.
 */
function rows() {
  return world({
    [HEADING]: { object: "block", id: HEADING, type: "heading_2", parent: inPage(NOTICE_PAGE),
                 last_edited_time: EDITED, heading_2: { rich_text: [run("진행 사항")] } },
    "가": block("가", "bulleted_list_item", [run("서류 접수")], inPage(NOTICE_PAGE)),
    "나": block("나", "bulleted_list_item", [run("현장 실사")], inPage(NOTICE_PAGE)),
    "다": block("다", "to_do", [run("보고서 제출")], inPage(NOTICE_PAGE),
                { to_do: { rich_text: [run("보고서 제출")], checked: true } }),
    [LOCKED]: { object: "block", id: LOCKED, type: "image", parent: inPage(NOTICE_PAGE),
                last_edited_time: EDITED, image: { type: "external", external: { url: "x" } } },
  });
}

describe("줄을 옮긴다", () => {
  it("「이 줄 다음」으로 짚으면 그 그릇 그 자리에 다시 만든다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", { after: "가" })] });

    expect(res.status).toBe(200);
    const [made] = appends(calls);
    expect(made.path).toBe(`/blocks/${NOTICE_PAGE}/children`);
    expect(made.body.position).toEqual({ type: "after_block", after_block: { id: "가" } });
    expect(made.body.children[0].type).toBe("to_do");
  });

  it("「이 줄 앞」으로 짚으면 그 앞 줄 다음이 자리다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({ changes: [move("다", { before: "나" })] });

    const [made] = appends(calls);
    expect(made.body.position).toEqual({ type: "after_block", after_block: { id: "가" } });
  });

  it("맨 앞으로 가면 그릇의 처음이 자리다", async () => {
    // ITEM 이 이 공지의 첫 블록이다. 그 앞이면 짚을 발판이 없다.
    const { calls } = installNotion({ blocks: rows() });
    await save({ changes: [move("다", { before: ITEM })] });

    const [made] = appends(calls);
    expect(made.body.position).toEqual({ type: "start" });
  });

  it("들여쓰면 그 줄 안으로 들어간다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({ changes: [move("다", { into: "나" })] });

    const [made] = appends(calls);
    expect(made.path).toBe("/blocks/나/children");
    // 자리를 짚지 않는다 — 그 줄의 마지막 자식이 된다.
    expect(made.body.position).toBeUndefined();
  });

  it("내어쓰기는 품고 있던 줄을 발판으로 짚는 것이다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    // NESTED 는 ITEM 안에 있다. ITEM 다음을 짚으면 한 겹 밖으로 나온다 —
    // 내어쓰기에 따로 낱말을 두지 않는 까닭이 이것이다.
    await save({ changes: [move(NESTED, { after: ITEM })] });

    const [made] = appends(calls);
    expect(made.path).toBe(`/blocks/${NOTICE_PAGE}/children`);
    expect(made.body.position).toEqual({ type: "after_block", after_block: { id: ITEM } });
  });

  it("글과 서식과 체크를 그대로 안고 간다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({ changes: [move("다", { after: "가" })] });

    const [made] = appends(calls);
    const body = made.body.children[0].to_do;
    expect(body.rich_text[0].text.content).toBe("보고서 제출");
    expect(body.checked).toBe(true);
  });

  it("새 주소를 돌려준다 — 옛 주소도 함께다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", { after: "가" })] });
    const body = await res.json();

    const [r] = body.results;
    expect(r.status).toBe("ok");
    expect(r.blockId).toBe("다");
    expect(r.newBlockId).toBeTruthy();
    expect(r.newBlockId).not.toBe("다");
    // 지운 것은 옛 주소, 남은 것은 새 주소다.
    expect(deletes(calls).map((c) => c.path)).toEqual(["/blocks/다"]);
    expect(r.html).toBe("보고서 제출");
    expect(r.type).toBe("to_do");
  });

  it("만들고 나서 지운다 — 그 차례가 뒤집히면 실패할 때 줄이 사라진다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({ changes: [move("다", { after: "가" })] });

    const order = writes(calls).map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual([
      `PATCH /blocks/${NOTICE_PAGE}/children`,
      "DELETE /blocks/다",
    ]);
  });

  it("옛 줄을 지우지 못하면 새 주소를 함께 돌려준다", async () => {
    // 새 줄은 이미 들어갔다. 실패로만 말하면 화면은 옛 주소를 쥔 채로 남고,
    // 다시 저장할 때마다 노션에 사본이 하나씩 는다.
    const { calls } = installNotion({
      blocks: rows(),
      fail: (method) => (method === "DELETE"
        ? new Response(JSON.stringify({ message: "노션이 거절했습니다" }), { status: 400 })
        : null),
    });
    const res = await save({ changes: [move("다", { after: "가" })] });
    const [r] = (await res.json()).results;

    expect(r.status).toBe("failed");
    expect(r.newBlockId).toBeTruthy();
    expect(r.detail).toMatch(/옛 줄이 노션에 남았습니다/);
    expect(appends(calls)).toHaveLength(1);
  });

  it("붙이기가 실패하면 옛 줄을 지우지 않는다", async () => {
    const { calls } = installNotion({
      blocks: rows(),
      fail: (method, path) => (method === "PATCH" && path.endsWith("/children")
        ? new Response(JSON.stringify({ message: "노션이 거절했습니다" }), { status: 400 })
        : null),
    });
    const res = await save({ changes: [move("다", { after: "가" })] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(deletes(calls)).toHaveLength(0);
    expect(dispatches(calls)).toHaveLength(0);
  });
});

describe("옮길 수 없는 줄은 노션에 닿기 전에 막힌다", () => {
  it("안에 든 줄이 있으면 locked 다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move(ITEM, { after: "가" })] });
    const body = await res.json();

    expect(body.results[0].status).toBe("locked");
    expect(body.results[0].detail).toMatch(/안에 든 줄/);
    expect(writes(calls)).toHaveLength(0);
  });

  it("잠긴 줄은 locked 다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move(LOCKED, { after: "가" })] });
    const body = await res.json();

    expect(body.results[0].status).toBe("locked");
    expect(body.results[0].detail).toBe("그림");
    expect(writes(calls)).toHaveLength(0);
  });

  it("종류 바꾸기도 같은 판정을 받는다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [retype(ITEM, "paragraph")] });
    const body = await res.json();

    expect(body.results[0].status).toBe("locked");
    expect(writes(calls)).toHaveLength(0);
  });

  it("글로 고칠 수 없는 줄 안으로는 들여쓰지 못한다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", { into: LOCKED })] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });

  it("모르는 낱말로 자리를 짚으면 거절한다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", { out: true })] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });

  it("자리를 짚지 않으면 거절한다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", {})] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });

  it("자기 자신을 발판으로 삼을 수 없다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", { after: "다" })] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });

  it("남의 기업 줄을 발판으로 삼으면 저장 전체가 막힌다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", { after: OUTSIDER })] });

    expect(res.status).toBe(404);
    expect(writes(calls)).toHaveLength(0);
  });

  it("화면이 본 뒤에 노션에서 먼저 바뀌었으면 옮기지 않는다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({
      changes: [move("다", { after: "가" }, "2020-01-01T00:00:00.000Z")],
    });
    const body = await res.json();

    expect(body.results[0].status).toBe("stale");
    expect(body.results[0].current.html).toBe("보고서 제출");
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("줄의 종류를 바꾼다", () => {
  it("여섯 가지 사이에서 바꾼다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [retype("가", "numbered_list_item")] });
    const body = await res.json();

    const [made] = appends(calls);
    expect(made.body.children[0].type).toBe("numbered_list_item");
    expect(made.body.children[0].numbered_list_item.rich_text[0].text.content)
      .toBe("서류 접수");
    // 있던 자리 그대로다 — 종류만 바뀐다.
    expect(made.body.position).toEqual({ type: "after_block", after_block: { id: "가" } });
    expect(body.results[0].type).toBe("numbered_list_item");
    expect(body.results[0].newBlockId).toBeTruthy();
  });

  it("할 일로 바꾸면 체크는 꺼진 채로 시작한다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({ changes: [retype("가", "to_do")] });

    expect(appends(calls)[0].body.children[0].to_do.checked).toBe(false);
  });

  it("모르는 종류는 거절한다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [retype("가", "heading_1")] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });

  it("이미 그 종류면 아무것도 하지 않는다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [retype("가", "bulleted_list_item")] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("다른 손질과 한 저장에 함께 실린다", () => {
  it("쓰는 차례는 고침 → 보탬 → 옮김 → 지움 이다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({
      changes: [
        { op: "remove", blockId: LOCKED, seen: EDITED },
        move("다", { after: "가" }),
        { op: "add", tempId: "n1", html: "새 줄", after: "가" },
        { op: "edit", blockId: "나", seen: EDITED, html: "현장 실사 완료" },
      ],
    });

    const order = writes(calls).map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual([
      "PATCH /blocks/나",                          // 고침
      `PATCH /blocks/${NOTICE_PAGE}/children`,     // 보탬
      `PATCH /blocks/${NOTICE_PAGE}/children`,     // 옮김 — 만들고
      "DELETE /blocks/다",                         //        지운다
      `DELETE /blocks/${LOCKED}`,                  // 지움
    ]);
  });

  it("같은 저장에서 방금 보탠 줄 다음으로도 옮긴다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({
      changes: [
        { op: "add", tempId: "n1", html: "새 줄", after: "가" },
        move("다", { afterNew: "n1" }),
      ],
    });
    const body = await res.json();

    const madeId = body.results[0].blockId;
    expect(body.results[1].status).toBe("ok");
    // 보태기가 먼저 나가고, 옮기기가 그 줄을 발판으로 삼는다.
    expect(appends(calls)[1].body.position)
      .toEqual({ type: "after_block", after_block: { id: madeId } });
  });

  it("모르는 임시 이름을 발판으로 삼으면 거절한다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({ changes: [move("다", { afterNew: "n9" })] });
    const body = await res.json();

    expect(body.results[0].status).toBe("failed");
    expect(writes(calls)).toHaveLength(0);
  });

  it("같은 줄을 고치고 옮기면 고친 글이 옮겨 간다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({
      changes: [
        { op: "edit", blockId: "나", seen: EDITED, html: "현장 실사 완료" },
        move("나", { after: "다" }),
      ],
    });

    const [made] = appends(calls);
    expect(made.body.children[0].bulleted_list_item.rich_text[0].text.content)
      .toBe("현장 실사 완료");
  });

  it("한 줄에 옮기기와 종류 바꾸기를 함께 보내면 뒤엣것만 거절한다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    const res = await save({
      changes: [move("다", { after: "가" }), retype("다", "paragraph")],
    });
    const body = await res.json();

    expect(body.results[0].status).toBe("ok");
    expect(body.results[1].status).toBe("failed");
    expect(appends(calls)).toHaveLength(1);
  });

  it("옮겨도 재빌드 신호는 한 번이다", async () => {
    const { calls } = installNotion({ blocks: rows() });
    await save({
      changes: [move("다", { after: "가" }), retype("가", "paragraph")],
    });

    expect(dispatches(calls)).toHaveLength(1);
  });

  it("옮기기는 세 칸, 종류 바꾸기는 두 칸을 쓴다", async () => {
    // 바깥 호출 상한 때문이다 — 옮기기 하나가 읽기 셋에 쓰기 둘이다.
    const { calls } = installNotion({ blocks: rows() });
    const many = Array.from({ length: 7 }, () => move("다", { after: "가" }));
    const res = await save({ changes: many });

    expect(res.status).toBe(422);
    expect(writes(calls)).toHaveLength(0);
    expect((await res.json()).detail).toMatch(/20/);
  });
});

describe("편집 모드가 무엇을 옮길 수 있는지 알아본다", () => {
  it("GET /notice/tree 가 안에 든 줄이 있는지 알려 준다", async () => {
    installNotion({ blocks: rows() });
    const res = await worker.fetch(new Request(
      "https://relay.test/notice/tree?slug=whiffkorea",
      { headers: { authorization: `Bearer ${b64(ENV.EDITOR_PASSWORD)}` } }), ENV);
    const body = await res.json();

    expect(body.items[ITEM].has_children).toBe(true);
    expect(body.items["가"].has_children).toBeUndefined();
  });
});
