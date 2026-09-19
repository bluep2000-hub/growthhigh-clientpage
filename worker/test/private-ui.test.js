import { describe, expect, it } from "vitest";
import vm from "node:vm";
import worker from "../src/private-index.js";
import { LOGIN_SCRIPT } from "../src/private-ui.js";

function browserHarness(search = "", replies = []) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden:false, disabled:false, value:"", textContent:"",
      classList:{toggle() {}}, handlers:{}, focus() {},
      addEventListener(name, fn) { this.handlers[name] = fn; }, replaceChildren() {} });
    return elements.get(id);
  };
  const requests = [], timers = [], events = {};
  let prompts = 0, googleLoads = 0;
  const document = { hidden:false, getElementById:element,
    addEventListener(name, fn) { events[name] = fn; }, createElement() { return {}; },
    head:{appendChild(script) { googleLoads += 1; script.onload(); }} };
  const context = { document, location:{search}, URLSearchParams, AbortSignal,
    setInterval(fn) { timers.push(fn); },
    fetch:async (url, options) => {
      requests.push({url, options});
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return Response.json(next?.body || {authenticated:false}, {status:next?.status || 200});
    }, google:{accounts:{id:{cancel() {},initialize() {},renderButton() {},disableAutoSelect() {},
      prompt() { prompts += 1; }}}} };
  context.window = context;
  vm.runInNewContext(LOGIN_SCRIPT, context);
  const settle = async () => { for (let n = 0; n < 10; n++) await new Promise(resolve => setImmediate(resolve)); };
  return {element, requests, timers, events, settle, prompts:() => prompts, googleLoads:() => googleLoads};
}

describe("위프코리아 로그인 화면", () => {
  it("비공개 서버에 고객 데이터 없는 로그인 화면만 제공한다", async () => {
    const response = await worker.fetch(new Request("https://private.test/whiffkorea/"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("GOCSPX-");
    expect(html).not.toContain("c/whiffkorea.enc");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const nonce = html.match(/<script nonce="([^"]+)"/)[1];
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
    expect((await worker.fetch(new Request("https://private.test/zeroback/"))).status).toBe(404);
  });
  it("고객은 Google 장치를 로드하지 않고 비밀번호를 같은 서버에만 전달한다", async () => {
    const h = browserHarness("", [{body:{authenticated:false}}, {body:{authenticated:true,slug:"whiffkorea"}}]);
    await h.settle();
    expect(h.element("staff-entry").hidden).toBe(true);
    expect(h.googleLoads()).toBe(0);
    h.element("pw").value = "synthetic-test-password";
    await h.element("gform").handlers.submit({preventDefault() {}});
    expect(h.requests[1].url).toBe("/whiffkorea/auth/customer/login");
    expect(h.requests[1].options.credentials).toBe("same-origin");
    expect(h.requests[1].options.body).toContain("synthetic-test-password");
    expect(h.element("pw").value).toBe("");
    expect(h.element("result").hidden).toBe(false);
    expect(h.element("entry").hidden).toBe(true);
  });
  it("잘못된 비밀번호는 다시 입력할 수 있고 확인 버튼을 복구한다", async () => {
    const h = browserHarness("", [{}, {status:401,body:{error:"unauthorized"}}]);
    await h.settle(); h.element("pw").value = "wrong";
    await h.element("gform").handlers.submit({preventDefault() {}});
    expect(h.element("gmsg").textContent).toBe("비밀번호가 올바르지 않습니다.");
    expect(h.element("gbtn").disabled).toBe(false);
    expect(h.element("result").hidden).toBe(true);
  });
  it("로그아웃 성공 후 인증 결과를 숨기며 세션 원문을 브라우저 저장소에 두지 않는다", async () => {
    const h = browserHarness("", [{body:{authenticated:true,slug:"whiffkorea"}}, {body:{authenticated:false}}]);
    await h.settle(); await h.element("logout").handlers.click();
    expect(h.requests[1].url).toBe("/whiffkorea/auth/customer/logout");
    expect(h.element("result").hidden).toBe(true);
    expect(LOGIN_SCRIPT).not.toMatch(/(?:localStorage|sessionStorage)/);
  });
  it("담당자는 별도 로그인 경로를 쓰고 처음부터 자동 로그인 팝업을 반복하지 않는다", async () => {
    const h = browserHarness("?edit", [{status:401,body:{error:"unauthorized"}},
      {body:{nonce:"synthetic-nonce",clientId:"synthetic-client"}}, {status:401,body:{error:"unauthorized"}}]);
    await h.settle(); await h.timers[0]();
    expect(h.element("gform").hidden).toBe(true);
    expect(h.requests.map(r => r.url)).toEqual(["/whiffkorea/auth/staff/session","/whiffkorea/auth/staff/challenge"]);
    expect(h.element("gmsg").textContent).toBe("");
    expect(h.prompts()).toBe(0);
  });
  it("기존 담당자 세션의 Google 증명이 만료되면 갱신을 시도하고 직접 재접속 버튼도 유지한다", async () => {
    const h = browserHarness("?edit", [{body:{authenticated:true,role:"대표",slug:"whiffkorea"}},
      {status:401,body:{error:"unauthorized"}}, {body:{nonce:"synthetic-nonce",clientId:"synthetic-client"}}]);
    await h.settle(); await h.timers[0]();
    expect(h.prompts()).toBe(1);
    expect(h.element("entry").hidden).toBe(false);
    expect(h.element("result").hidden).toBe(true);
    expect(h.element("retry").disabled).toBe(false);
  });
  it("담당 변경·권한 조회 실패 시 확인 결과를 숨기고 자동 로그인으로 우회하지 않는다", async () => {
    const h = browserHarness("?edit", [{body:{authenticated:true,role:"PM",slug:"whiffkorea"}},
      {status:403,body:{error:"not_assigned"}}]);
    await h.settle(); await h.timers[0]();
    expect(h.element("result").hidden).toBe(true);
    expect(h.element("gmsg").textContent).toContain("담당자로 등록된 계정");
    expect(h.prompts()).toBe(0);
  });
});
