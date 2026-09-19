import {readFileSync} from "node:fs";
import {join} from "node:path";
import vm from "node:vm";
import {describe,expect,it} from "vitest";

const html = readFileSync(join(process.cwd(), "..", "index.html"), "utf8");
const expression = html.match(/const edDocFingerprint = ([\s\S]*?);\r?\n\r?\n  function edFingerprint/)[1];

function fingerprint(doc) {
  const context = {doc};
  vm.runInNewContext(`result = (${expression})(doc)`, context);
  return context.result;
}

describe("공지 편집기 변경 감지", () => {
  it("같은 문서는 필드가 들어온 순서가 달라도 저장 완료로 판단한다", () => {
    const server = {
      title:"검수 공지",
      sections:[{id:"section-1",title:"진행사항",items:[{
        id:"item-1",type:"bullet",html:"같은 내용",items:[],
      }]}],
    };
    const screen = {
      title:"검수 공지",
      sections:[{id:"section-1",title:"진행사항",items:[{
        type:"bullet",html:"같은 내용",items:[],id:"item-1",
      }]}],
    };

    expect(fingerprint(screen)).toBe(fingerprint(server));
  });
});
