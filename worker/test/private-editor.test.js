import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/store.js", () => import("./fake-store.js"));

import { editorRequest } from "../src/private-editor.js";
import { reset, seed } from "./fake-store.js";
import { installNotion, dispatches, writes, run } from "./helpers.js";

const section = [{ id: "s1", title: "진행 사항", items: [
  { id: "i1", type: "bullet", html: "가짜 검수 내용", items: [] },
] }];

function environment(jobs) {
  return { DB: {}, PRIVATE_DB: {
    prepare(sql) {
      return { bind(...values) { return { async run() { jobs.push({ sql, values }); } }; } };
    },
  } };
}

const request = (path, method = "GET") => new Request(`https://private.test${path}`, { method });

describe("Google 권한 뒤 기존 편집기 연결", () => {
  beforeEach(() => reset());

  it("비공개 고객은 노션 등록과 기업 범위를 확인한 뒤 자료 갱신 대기열에 넣는다", async()=>{
    for(const slug of ['bowlgames','dameungyeol','whiffkorea','welldoneproduct','sayuzone','sywells']) {
      const {calls}=installNotion({share:{results:[{id:'client-page',properties:{
        '슬러그':{rich_text:[run(slug)]}}}]}});
      const jobs=[];
      const response=await editorRequest(request('/room/rebuild','POST'),
        {...environment(jobs),NOTION_TOKEN:'fake'}, {slug},slug);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({slug,rebuild:'sent'});
      expect(jobs).toHaveLength(1);
      expect(jobs[0].values[0]).toBe(slug);
      expect(dispatches(calls)).toHaveLength(0);
      expect(writes(calls)).toHaveLength(0);
      await expect(editorRequest(request('/room/rebuild','POST'),environment(jobs),
        {slug:'other-customer'},slug)).rejects.toMatchObject({status:403});
    }
    installNotion({share:{results:[]}});
    const jobs=[];
    const absent=await editorRequest(request('/room/rebuild','POST'),
      {...environment(jobs),NOTION_TOKEN:'fake'},{slug:'absent'},'absent');
    expect(absent.status).toBe(404);expect(jobs).toHaveLength(0);
  });

  it("위프코리아 공지 초안만 읽고 다른 기업은 거절한다", async () => {
    seed({ id: "notice-1", slug: "whiffkorea", date: "2026-09-19", title: "9월 공지", sections: section });
    const response = await editorRequest(request("/notice/doc/draft?slug=whiffkorea"), environment([]));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ noticeId: "notice-1", slug: "whiffkorea" });
    await expect(editorRequest(request("/notice/doc/draft?slug=zeroback"), environment([])))
      .rejects.toMatchObject({ status: 403, code: "not_assigned" });
  });

  it("자동저장은 공개본을 바꾸지 않고 게시할 때만 비공개 갱신을 요청한다", async () => {
    seed({ id: "notice-1", slug: "whiffkorea", date: "2026-09-19", title: "9월 공지", sections: section, version: 3 });
    const jobs = [];
    const env = environment(jobs);
    const opened = await (await editorRequest(request("/notice/doc/draft?slug=whiffkorea"), env)).json();
    const saved = await (await editorRequest(request("/notice/doc/draft", "PUT"), env, {
      slug: "whiffkorea", noticeId: "notice-1", draftVersion: opened.draftVersion,
      title: "고친 공지", sections: section,
    })).json();
    expect(jobs).toHaveLength(0);

    const published = await (await editorRequest(request("/notice/doc/publish", "POST"), env, {
      slug: "whiffkorea", noticeId: "notice-1", draftVersion: saved.draftVersion,
      publishedVersion: saved.publishedVersion,
    })).json();
    expect(published).toMatchObject({ title: "고친 공지", rebuild: "sent" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sql).toContain("private_rebuild_job");
  });
});
