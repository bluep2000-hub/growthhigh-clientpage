import template from "../../index.html";

// 고객 UI는 기존 원본을 쓰고, 공개 봉투 읽기만 서버 인증 후 읽기로 바꾼다.
export function customerPage() {
  const nonce = crypto.randomUUID();
  const start = template.indexOf("(async function boot(){");
  const end = template.indexOf("/* ── 렌더 ── */",start);
  if (start < 0 || end < start) throw new Error("private_template_boundary_missing");
  const boot = `(async function boot(){
    try {
      const response = await fetch('/api/customer'+location.search, {cache:'no-store',credentials:'same-origin'});
      if (response.status === 401 || response.status === 403) return location.replace('/whiffkorea/' + location.search);
      if (!response.ok) return fatal('정보를 준비하고 있습니다.<br>잠시 후 다시 접속해 주세요.');
      const data = await response.json();
      ENV = {enc:false};
      unlock(data);
    } catch (_) { fatal('연결하지 못했습니다.<br>잠시 후 다시 접속해 주세요.'); }
  })();
  `;
  let html = template.slice(0,start)+boot+template.slice(end);
  html = html.replace("const BASE = (typeof window.__BASE__ === 'string') ? window.__BASE__ : '';", "const BASE = ''; ")
    .replace("const CLIENT = clean(window.__SLUG__) || clean(Q.get('c') || Q.get('client')) || null;", "const CLIENT = 'whiffkorea';")
    .replace("const BRAND_LOGO = `${BASE}assets/growthhigh-logo.png`;", "const BRAND_LOGO = 'https://client.growthhigh.co.kr/assets/growthhigh-logo.png';");
  html = html.replaceAll('<script>', '<script nonce="'+nonce+'">');
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin',
    'content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; img-src 'self' https://client.growthhigh.co.kr data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
}
