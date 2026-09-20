import template from "../../index.html";

// 고객 UI는 기존 원본을 쓰고, 공개 봉투 읽기만 서버 인증 후 읽기로 바꾼다.
export function customerPage(staff = false, slug = "whiffkorea") {
  const nonce = crypto.randomUUID();
  const start = template.indexOf("(async function boot(){");
  const end = template.indexOf("/* ── 렌더 ── */",start);
  if (start < 0 || end < start) throw new Error("private_template_boundary_missing");
  const boot = `(async function boot(){
    try {
      const response = await fetch('/${slug}/api/customer'+location.search, {cache:'no-store',credentials:'same-origin'});
      if (response.status === 401 || response.status === 403) return location.replace('/${slug}/' + location.search);
      if (!response.ok) return fatal('정보를 준비하고 있습니다.<br>잠시 후 다시 접속해 주세요.');
      const data = await response.json();
      ENV = {enc:false};
      unlock(data);
    } catch (_) { fatal('연결하지 못했습니다.<br>잠시 후 다시 접속해 주세요.'); }
  })();
  `;
  let html = template.slice(0,start)+boot+template.slice(end);
  const editorStart = html.indexOf('  const ED = {');
  const editorEnd = html.indexOf('  /* 공지와 데이터룸에서 같은 담당자 인증을 사용한다 */',editorStart);
  const bindStart = html.indexOf('  function bindEditSwitch(){',editorEnd);
  const bindEnd = html.indexOf('  /* ══ 공지 편집기',bindStart);
  if (editorStart < 0 || editorEnd < editorStart || bindStart < 0 || bindEnd < bindStart)
    throw new Error('private_editor_template_boundary_missing');
  const editor = `  const ED = {
    active:false, can(){ return ${staff}; }, token(){ return this.active ? 'active' : ''; },
    on(){ return this.can() && this.active; },
    async unlock(){ await this.call('GET','/auth/staff/session'); this.active=true; return true; },
    async call(method,path,body,signal){
      const response=await fetch('/${slug}'+path,{method,credentials:'same-origin',cache:'no-store',
        headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal});
      const data=await response.json();
      if(!response.ok){const error=new Error(data.detail||data.error||'연결하지 못했습니다');error.status=response.status;error.code=data.error;error.data=data;
        if(response.status===401||response.status===403){this.active=false;}throw error;}
      return data;
    }
  };
  `;
  const bind = `  function bindEditSwitch(){
    const off=document.querySelector('[data-edoff]');
    if(off) off.onclick=()=>{if(!edMayLeave())return;edForgetAll();ED.active=false;go(document.querySelector('.nv.on')?.dataset.id||'notice');};
    const on=document.querySelector('[data-edon]');
    if(on) on.onclick=async()=>{on.disabled=true;try{await ED.unlock();go(document.querySelector('.nv.on')?.dataset.id||'notice');}
      catch(_){alert('담당자 로그인을 다시 확인해 주세요.');}finally{on.disabled=false;}};
  }
  `;
  html = html.slice(0,editorStart)+editor+html.slice(editorEnd,bindStart)+bind+html.slice(bindEnd);
  html = html.replaceAll('sessionStorage.setItem(SKEY, JSON.stringify(D))','void 0');
  // 비공개 서버는 GitHub 배포가 아니라 갱신 대기열을 쓴다. 담당자에게 실제 흐름만 안내한다.
  html = html.replace("edSetState('published', '게시됨 · 고객 화면 반영 중', '보통 1~2분 안에 반영됩니다');",
    "edSetState('published', '게시됨 · 고객 화면 반영 요청됨', '다음 자동 갱신 때 반영됩니다');")
    .replace("roomRebuildMessage = '반영 요청을 보냈습니다. 배포 후 새 고객 탭에서 확인해 주세요.';",
      "roomRebuildMessage = '반영 요청을 보냈습니다. 다음 자동 갱신 후 새 고객 탭에서 확인해 주세요.';")
    .replace(/\s*<a href="https:\/\/github\.com\/bluep2000-hub\/growthhigh-clientpage\/actions\/workflows\/rebuild\.yml"[\s\S]*?<\/a>/, '');
  html = html.replace(/const BASE = .*?;/, "const BASE = '';")
    .replace(/const CLIENT = .*?;/, `const CLIENT = ${JSON.stringify(slug)};`)
    .replace(/const BRAND_LOGO = .*?;/, "const BRAND_LOGO = 'https://client.growthhigh.co.kr/assets/growthhigh-logo.png';");
  html = html.replaceAll('<script>', '<script nonce="'+nonce+'">');
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin',
    'content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; img-src 'self' https://client.growthhigh.co.kr data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
}
