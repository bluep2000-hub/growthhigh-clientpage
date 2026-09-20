import {readFileSync} from "node:fs";
import {join} from "node:path";
import vm from "node:vm";
import {describe,expect,it} from "vitest";

const html = readFileSync(join(process.cwd(), "..", "index.html"), "utf8");
const source = html.match(/async function edOpenDraft\(\)\{[\s\S]*?\n  \}/)?.[0];

describe("첫 공지 편집", () => {
  it("공지가 없으면 빈 초안을 자동으로 만든다", async () => {
    const calls = [];
    const doc = {noticeId:"first", title:"", sections:[]};
    const context = {
      CLIENT:"bowlgames",
      ED:{call:async (...args) => {
        calls.push(args);
        if(args[0] === "GET") throw Object.assign(new Error("not found"), {status:404});
        return doc;
      }},
    };
    vm.runInNewContext(`${source}; result = edOpenDraft()`, context);

    await expect(context.result).resolves.toEqual(doc);
    expect(calls).toEqual([
      ["GET", "/notice/doc/draft?slug=bowlgames"],
      ["POST", "/notice/doc", {slug:"bowlgames"}],
    ]);
  });
});
