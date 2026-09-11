/**
 * 공지 초안 자동저장과 게시를 분리한다.
 *
 * 자동저장은 고객에게 보이는 notices 와 지난 게시본 revisions 를 건드리지
 * 않는다. 게시만 둘을 바꾸고 재빌드를 한 번 요청한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/store.js", () => import("./fake-store.js"));

import worker from "../src/index.js";
import { reset, seed, stored, storedDraft } from "./fake-store.js";
import { dispatches, ENV, installNotion } from "./helpers.js";

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const editor = b64(ENV.EDITOR_PASSWORD);
const BUILD = "build-token-abcd";
const ENV_DB = { ...ENV, DB: {}, BUILD_TOKEN: BUILD };
const headers = { authorization: `Bearer ${editor}`, "content-type": "application/json" };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(() => { reset(); });

const line = (html, id = "n1") => ({ id, type: "bullet", html, items: [] });

function whiff(extra = {}) {
  return seed({
    id: "notice-1", slug: "whiffkorea", date: "2026-09-11",
    title: "게시된 제목", version: 3,
    sections: [{ id: "s1", title: "진행 상황", items: [line("게시된 내용")] }],
    ...extra,
  });
}

function readDraft() {
  return worker.fetch(new Request(
    "https://relay.test/notice/doc/draft?slug=whiffkorea",
    { headers: { authorization: `Bearer ${editor}` } }), ENV_DB);
}

function saveDraft(body) {
  return worker.fetch(new Request("https://relay.test/notice/doc/draft", {
    method: "PUT", headers, body: JSON.stringify({
      slug: "whiffkorea", noticeId: "notice-1", ...body,
    }),
  }), ENV_DB);
}

function publish(body) {
  return worker.fetch(new Request("https://relay.test/notice/doc/publish", {
    method: "POST", headers, body: JSON.stringify({
      slug: "whiffkorea", noticeId: "notice-1", ...body,
    }),
  }), ENV_DB);
}

function exportDoc() {
  return worker.fetch(new Request("https://relay.test/notice/export?slug=whiffkorea", {
    headers: { authorization: `Bearer ${BUILD}` },
  }), ENV_DB);
}

describe("초안 자동저장", () => {
  it("처음 열 때 게시본을 초안으로 복사한다", async () => {
    whiff();

    const res = await readDraft();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      noticeId: "notice-1", title: "게시된 제목",
      draftVersion: 1, publishedVersion: 3,
      basePublishedVersion: 3, hasUnpublishedChanges: false,
    });
    expect(storedDraft("notice-1").sections[0].items[0].html).toBe("게시된 내용");
  });

  it("초안만 바꾸고 게시본과 재빌드는 건드리지 않는다", async () => {
    const { calls } = installNotion();
    whiff();
    await readDraft();

    const res = await saveDraft({
      draftVersion: 1, title: "미팅 직후 초안",
      sections: [{ id: "s1", title: "진행 상황", items: [line("아직 비공개")] }],
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      draftVersion: 2, publishedVersion: 3, hasUnpublishedChanges: true,
    });
    expect(stored("notice-1").title).toBe("게시된 제목");
    expect(storedDraft("notice-1").title).toBe("미팅 직후 초안");
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("초안 판이 어긋나면 현재 초안을 돌려주고 덮어쓰지 않는다", async () => {
    whiff();
    await readDraft();
    await saveDraft({ draftVersion: 1, title: "먼저 저장",
                      sections: [{ title: "칸", items: [line("먼저")]}] });

    const res = await saveDraft({ draftVersion: 1, title: "늦게 저장",
                                  sections: [{ title: "칸", items: [line("늦게")]}] });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "stale", current: { draftVersion: 2, title: "먼저 저장" },
    });
    expect(storedDraft("notice-1").title).toBe("먼저 저장");
  });

  it("문서 상한을 넘으면 초안을 바꾸지 않는다", async () => {
    whiff();
    await readDraft();

    const res = await saveDraft({
      draftVersion: 1, title: "x".repeat(201), sections: [],
    });

    expect(res.status).toBe(422);
    expect(storedDraft("notice-1").version).toBe(1);
  });
});

describe("게시", () => {
  it("초안을 게시본으로 승격하고 재빌드를 한 번 부른다", async () => {
    const { calls } = installNotion();
    whiff();
    await readDraft();
    await saveDraft({
      draftVersion: 1, title: "게시할 제목",
      sections: [{ id: "s1", title: "진행 상황", items: [line("고객에게 공개")] }],
    });

    const res = await publish({ draftVersion: 2, publishedVersion: 3 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      title: "게시할 제목", publishedVersion: 4,
      basePublishedVersion: 4, hasUnpublishedChanges: false, rebuild: "sent",
    });
    expect(stored("notice-1")).toMatchObject({ title: "게시할 제목", version: 4 });
    expect(dispatches(calls)).toHaveLength(1);
  });

  it("같은 게시 요청이 다시 와도 재빌드를 반복하지 않는다", async () => {
    const { calls } = installNotion();
    whiff();
    await readDraft();

    const res = await publish({ draftVersion: 1, publishedVersion: 3 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      publishedVersion: 3, hasUnpublishedChanges: false, rebuild: "not_needed",
    });
    expect(stored("notice-1").version).toBe(3);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("초안이 있는 동안 내보내기는 계속 게시본만 준다", async () => {
    whiff();
    await readDraft();
    await saveDraft({ draftVersion: 1, title: "비공개 초안",
                      sections: [{ title: "칸", items: [line("비공개")]}] });

    const body = await (await exportDoc()).json();

    expect(body.title).toBe("게시된 제목");
    expect(body.sections[0].items[0].html).toBe("게시된 내용");
  });

  it("내용이 없는 초안은 게시하지 않는다", async () => {
    const { calls } = installNotion();
    whiff();
    await readDraft();
    await saveDraft({ draftVersion: 1, title: "제목만", sections: [] });

    const res = await publish({ draftVersion: 2, publishedVersion: 3 });

    expect(res.status).toBe(422);
    expect(stored("notice-1").version).toBe(3);
    expect(dispatches(calls)).toHaveLength(0);
  });

  it("게시본 판이 어긋나면 최신 상태를 주고 게시하지 않는다", async () => {
    whiff();
    await readDraft();
    await saveDraft({ draftVersion: 1, title: "내 초안",
                      sections: [{ title: "칸", items: [line("내 내용")]}] });

    const res = await publish({ draftVersion: 2, publishedVersion: 2 });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "stale", current: { publishedVersion: 3, title: "내 초안" },
    });
    expect(stored("notice-1").version).toBe(3);
  });

  it("아직 게시하지 않은 새 공지는 이전 게시본을 밀어내지 않는다", async () => {
    seed({ id: "old", slug: "whiffkorea", date: "2026-09-10",
           title: "어제 공지", sections: [{ title: "칸", items: [line("어제", "old-n")] }] });
    seed({ id: "new", slug: "whiffkorea", date: "2026-09-11",
           title: "", sections: [], publishedAt: null });

    const body = await (await exportDoc()).json();

    expect(body.noticeId).toBe("old");
    expect(body.title).toBe("어제 공지");
  });
});

describe("이전 게시본을 초안으로 불러오기", () => {
  it("바로 게시하지 않고 초안만 바꾼다", async () => {
    const { calls } = installNotion();
    whiff();
    await readDraft();
    await saveDraft({ draftVersion: 1, title: "두 번째",
                      sections: [{ title: "칸", items: [line("두 번째")]}] });
    await publish({ draftVersion: 2, publishedVersion: 3 });
    const before = dispatches(calls).length;

    const res = await worker.fetch(new Request(
      "https://relay.test/notice/doc/revision-to-draft", {
        method: "POST", headers, body: JSON.stringify({
          slug: "whiffkorea", noticeId: "notice-1", draftVersion: 2, revision: 3,
        }),
      }), ENV_DB);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      title: "게시된 제목", draftVersion: 3,
      publishedVersion: 4, hasUnpublishedChanges: true,
    });
    expect(stored("notice-1").title).toBe("두 번째");
    expect(dispatches(calls)).toHaveLength(before);
  });
});
