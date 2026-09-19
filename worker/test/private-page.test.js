import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import worker from "../src/private-index.js";
import {customerPage} from "../src/private-page.js";
import {privateDb} from "./private-db.js";
import {createPrivateStore} from "../src/private-store.js";
import {customerLogin,sessionCookie,setCustomerPassword} from "../src/private-auth.js";

const data = () => ({generated_at:"2026-09-19T12:00:00+09:00",company:{name:"가상 고객"},notice:null,
  perf:null,progress:[],recommend:[],talks:[],actions:[],actions_done:0,events:[],kpi:{}});

describe("비공개 고객 데이터와 기존 화면 연결",()=>{
  it("기존 위프코리아 주소는 검색값과 화면 위치를 보안 주소로 넘긴다",()=>{
    const html=readFileSync(new URL("../../whiffkorea/index.html",import.meta.url),"utf8");
    expect(html).toContain("location.search + location.hash");
    expect(html).toContain("growthhigh-clientpage-private.growthhigh-clientpage-worker.workers.dev/whiffkorea/");
    expect(html).not.toContain("데이터룸");
  });
  it("고객 UI는 기존 구조를 유지하고 공개 봉투·캐시로 잠금 해제를 하지 않는다",async()=>{
    const page = customerPage(); const html = await page.text();
    expect(html).toContain("데이터룸");
    expect(html).toContain("fetch('/whiffkorea/api/customer'+location.search");
    expect(html).not.toContain("res = await fetch(SRC");
    expect(html).not.toContain("const cached = sessionStorage.getItem(SKEY)");
    expect(html).toContain("ENV = {enc:false}");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'nonce-");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await customerPage(false).text()).toContain("can(){ return false; }");
    const staff = await customerPage(true).text();
    expect(staff).toContain("can(){ return true; }");
    expect(staff).toContain("credentials:'same-origin'");
    expect(staff).toContain("fetch('/whiffkorea'+path");
    expect(staff).not.toContain("sessionStorage.setItem(SKEY, JSON.stringify(D))");
    expect(staff).not.toContain("github.com/bluep2000-hub/growthhigh-clientpage/actions");
    expect(staff).toContain("다음 자동 갱신 때 반영됩니다");
    expect(staff).toContain("다음 자동 갱신 후 새 고객 탭에서 확인해 주세요");
  });
  it("미인증 고객은 화면·본문·이미지 모두 받을 수 없다",async()=>{
    const {sqlite,db} = privateDb();
    try { for(const path of ['/whiffkorea/api/customer','/whiffkorea/page/','/whiffkorea/page/logo/whiffkorea.png']) {
      const response = await worker.fetch(new Request('https://private.test'+path),{PRIVATE_DB:db});
      expect(response.status).toBe(401); expect(await response.text()).not.toContain('가상 고객');
    }} finally {sqlite.close();}
  });
  it("위프코리아 밖의 공용 경로에는 고객 API를 만들지 않는다",async()=>{
    for(const path of ['/api/customer','/auth/customer/session','/notice/doc','/room/pin','/talk/major']) {
      const response=await worker.fetch(new Request('https://private.test'+path));
      expect(response.status).toBe(404);
    }
  });
  it("미완성 결과와 이미지 누락을 거절하고 완성된 같은 판만 읽는다",async()=>{
    const {sqlite,db} = privateDb(); const store=createPrivateStore({PRIVATE_DB:db});
    try {
      sqlite.prepare("INSERT INTO customer_snapshots(slug,build_key,source_started_at,payload,saved_at,ready) VALUES('whiffkorea','pending',100,?,'now',0)").run(JSON.stringify(data()));
      expect(await store.latest('whiffkorea')).toBeNull();
      const input={slug:'whiffkorea',buildKey:'finished',startedAt:2,payload:{...data(),company:{name:'가상 고객',logo:'logo/whiffkorea.png'}}};
      await expect(store.save(input)).rejects.toThrow('missing_customer_asset');
      await store.save({...input,assets:{'logo/whiffkorea.png':{type:'image/png',data:'YWJjZA=='}}});
      expect((await store.latest('whiffkorea')).buildKey).toBe('finished');
      expect((await store.asset('whiffkorea','logo/whiffkorea.png')).content_base64).toBe('YWJjZA==');
      const env={PRIVATE_DB:db,AUTH_PEPPER:'a'.repeat(43)};
      await setCustomerPassword(env,'whiffkorea','test-password');
      const token=await customerLogin(new Request('https://private.test/'),env,{slug:'whiffkorea',password:'test-password'});
      const image=await worker.fetch(new Request('https://private.test/whiffkorea/page/logo/whiffkorea.png',
        {headers:{cookie:sessionCookie('customer',token).split(';')[0]}}),env);
      expect(image.status).toBe(200);
      expect(new TextDecoder().decode(await image.arrayBuffer())).toBe('abcd');
      await expect(store.save({...input,buildKey:'unsafe',assets:{'../secret':{type:'image/png',data:'YWJjZA=='}}})).rejects.toThrow();
      expect((await store.latest('whiffkorea')).buildKey).toBe('finished');
    } finally {sqlite.close();}
  });
});
