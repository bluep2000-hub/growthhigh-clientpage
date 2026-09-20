// 기존 잠금 화면의 색·폭·로고·문구를 재사용한다. 고객 데이터는 포함하지 않는다.
export const LOGIN_SCRIPT = String.raw`
(() => {
  const el = id => document.getElementById(id);
  const staff = new URLSearchParams(location.search).has('edit');
  const kind = staff ? 'staff' : 'customer';
  const slug = (location.pathname || '/whiffkorea/').split('/').filter(Boolean)[0];
  const base = '/' + slug;
  el('openpage').href = base + '/page/' + (staff ? '?edit' : '');
  let googleReady, googleBusy = false, checkBusy = false, authenticated = false;
  const messages = {
    unauthorized: staff ? 'Google 로그인을 다시 확인해 주세요.' : '비밀번호가 올바르지 않습니다.',
    staff_not_registered: '등록된 그로스하이 계정으로 로그인해 주세요.',
    not_assigned: '이 기업의 담당자로 등록된 계정이 아닙니다.',
    auth_not_configured: '로그인 연결을 준비 중입니다. 담당 컨설턴트에게 알려 주세요.',
    google_unavailable: 'Google에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    too_many_requests: '요청이 많습니다. 1분 후 다시 시도해 주세요.',
    notion_failed: '담당자 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  };
  function message(text, busy = false) {
    el('gmsg').textContent = text;
    el('gmsg').classList.toggle('busy', busy);
  }
  async function call(path, input) {
    let res;
    try {
      res = await fetch(base + '/auth/' + kind + '/' + path, {
        method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: input === undefined ? {} : {'Content-Type':'application/json'},
        body: input === undefined ? undefined : JSON.stringify(input),
        signal: AbortSignal.timeout(15000)
      });
    } catch (_) { throw new Error('연결하지 못했습니다. 다시 시도해 주세요.'); }
    let data;
    try { data = await res.json(); } catch (_) { throw new Error('응답을 확인하지 못했습니다. 다시 시도해 주세요.'); }
    if (!res.ok) {
      const err = new Error(messages[data.error] || '로그인을 확인하지 못했습니다. 다시 시도해 주세요.');
      err.status = res.status; throw err;
    }
    return data;
  }
  function showSession(session) {
    authenticated = !!session.authenticated;
    el('entry').hidden = authenticated;
    el('result').hidden = !authenticated;
    el('staff-tools').hidden = !(staff && authenticated);
    el('gtitle').textContent = authenticated ? '로그인 확인 완료' : staff ? '담당자 로그인' : '클라이언트 페이지';
    el('gsub').textContent = authenticated
      ? (staff ? '담당 기업과 내부 권한을 확인했습니다.' : '기업 비밀번호로 접속을 확인했습니다.')
      : staff ? '등록된 그로스하이 Google 계정으로 접속해 주세요.' : '담당 컨설턴트에게 받은 비밀번호를 입력해 주세요.';
    if (authenticated) {
      el('scope').textContent = staff ? session.role + ' · ' + slug : '고객 · ' + slug;
      message('');
    }
  }
  function loadGoogle() {
    if (!googleReady) googleReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      script.onload = resolve;
      script.onerror = () => { googleReady = null; reject(new Error(messages.google_unavailable)); };
      document.head.appendChild(script);
    });
    return googleReady;
  }
  async function prepareGoogle(renew = false) {
    if (googleBusy) return;
    googleBusy = true;
    el('retry').disabled = true;
    try {
      message('Google 로그인 준비 중…', true);
      await loadGoogle();
      const challenge = await call('challenge', {});
      google.accounts.id.cancel();
      google.accounts.id.initialize({
        client_id: challenge.clientId, nonce: challenge.nonce,
        auto_select: true, use_fedcm_for_prompt: true,
        callback: async response => {
          message('담당자 권한 확인 중…', true);
          try { showSession(await call('login', {credential:response.credential})); }
          catch (err) { await prepareGoogle(false); message(err.message); }
        }
      });
      el('google').replaceChildren();
      google.accounts.id.renderButton(el('google'), {
        type:'standard', theme:'outline', size:'large', text:'signin_with', width:300, locale:'ko'
      });
      message(renew ? 'Google 로그인 확인이 필요합니다. 아래 버튼으로 다시 접속할 수 있습니다.' : '');
      if (renew) google.accounts.id.prompt();
    } catch (err) { message(err.message); }
    finally { googleBusy = false; el('retry').disabled = false; }
  }
  async function checkSession(renew = false) {
    if (checkBusy || document.hidden || (renew && !authenticated)) return;
    checkBusy = true;
    const wasAuthenticated = authenticated;
    try {
      const session = await call('session');
      showSession(session);
      if (staff && !session.authenticated && renew && wasAuthenticated) await prepareGoogle(true);
    } catch (err) {
      // 권한 제거·만료·조회 실패를 구분하되 실패한 상태에서 관리 작업은 허용하지 않는다.
      showSession({authenticated:false});
      message(err.message);
      if (staff && err.status === 401 && renew && wasAuthenticated) await prepareGoogle(true);
    } finally { checkBusy = false; }
  }
  el('gform').hidden = staff;
  el('staff-entry').hidden = !staff;
  showSession({authenticated:false});
  el('gform').addEventListener('submit', async event => {
    event.preventDefault();
    if (el('gbtn').disabled || !el('pw').value) return;
    el('gbtn').disabled = el('pw').disabled = true;
    message('확인 중…', true);
    try { showSession(await call('login', {slug, password:el('pw').value})); el('pw').value = ''; }
    catch (err) { message(err.message); }
    finally { el('gbtn').disabled = el('pw').disabled = false; if (!authenticated) el('pw').focus(); }
  });
  el('retry').addEventListener('click', () => prepareGoogle(false));
  el('pwform').addEventListener('submit', async event => {
    event.preventDefault();
    const first = el('newpw').value, second = el('newpw2').value;
    if (!first || first !== second) { el('pwmsg').textContent = '두 칸에 같은 비밀번호를 입력해 주세요.'; return; }
    el('setpw').disabled = true; el('pwmsg').textContent = '저장 중…';
    try {
      const response = await fetch(base + '/auth/customer/password', {
        method:'POST', credentials:'same-origin', cache:'no-store',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({slug,password:first}),
        signal:AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error();
      el('newpw').value = el('newpw2').value = '';
      el('pwmsg').textContent = '고객 비밀번호를 저장했습니다.';
    } catch (_) { el('pwmsg').textContent = '저장하지 못했습니다. 다시 시도해 주세요.'; }
    finally { el('setpw').disabled = false; }
  });
  el('logout').addEventListener('click', async () => {
    el('logout').disabled = true;
    try {
      await call('logout', {});
      if (staff && window.google?.accounts?.id?.disableAutoSelect)
        google.accounts.id.disableAutoSelect();
      showSession({authenticated:false});
      if (staff) await prepareGoogle(false); else el('pw').focus();
    } catch (err) { message(err.message); }
    finally { el('logout').disabled = false; }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(true); });
  // 실제 Google 증명·Notion 권한을 정기 확인한다. 별도의 로그인 만료기간은 추가하지 않는다.
  setInterval(() => checkSession(true), 60000);
  (async () => { await checkSession(false); if (staff && !authenticated) await prepareGoogle(false); })();
})();`;

export function loginPage(request, slug = "whiffkorea") {
  const nonce = crypto.randomUUID();
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>클라이언트 페이지 · GROWTH'HIGH</title>
    <style>
    :root{color-scheme:light;--bg:#f7f7f8;--panel:#fff;--tx:#25272c;--tx-2:#555963;--tx-3:#646974;--line:#d4d6db;--accent:#356bd7;--no:#b83232}
    *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--tx);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;line-height:1.6}
    [hidden]{display:none!important}.gt{width:100%;max-width:340px;text-align:center}.mk{display:inline-grid;width:52px;height:52px;margin-bottom:15px;border-radius:12px;background:#000;overflow:hidden}.mk img{width:100%;height:100%;object-fit:contain}
    h1{font-size:18px;font-weight:600;letter-spacing:-.02em;margin:0}p{margin:0}.sub{font-size:13px;color:var(--tx-2);margin-top:7px;text-wrap:pretty}
    form{margin-top:20px;display:flex;flex-direction:column;gap:9px}input{width:100%;height:44px;padding:0 13px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--tx);font:inherit;font-size:16px}input::placeholder{color:var(--tx-3)}
    button{min-height:44px;border:0;border-radius:7px;background:var(--accent);color:#fff;font:inherit;font-size:14px;cursor:pointer}button:hover{filter:brightness(.93)}button:disabled{opacity:.55;cursor:wait}input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}input:focus-visible{border-color:var(--accent)}
    .msg{font-size:13px;color:var(--no);min-height:22px;margin-top:12px}.msg.busy{color:var(--tx-2)}#staff-entry{margin-top:23px}#google{display:flex;justify-content:center;min-height:44px}#retry{background:transparent;color:var(--tx-2);font-size:12px;margin-top:10px;text-decoration:underline;text-underline-offset:3px}
    #result{margin-top:23px}#scope{font-size:14px;font-weight:600}#result .sub{margin:10px 0 20px}#logout{width:100%;background:var(--panel);border:1px solid var(--line);color:var(--tx)}#staff-tools{margin-top:18px;padding-top:18px;border-top:1px solid var(--line);text-align:left}#staff-tools h2{font-size:14px;margin:0 0 8px}#staff-tools form{margin-top:10px}.ok{font-size:12px;color:var(--tx-2);min-height:20px;margin-top:7px}::selection{background:#dce8ff}input{caret-color:var(--accent)}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#17181b;--panel:#222429;--tx:#f0f0f3;--tx-2:#b2b6c0;--tx-3:#a0a5b0;--line:#515763;--accent:#3876df;--no:#ff9a9a}.mk{outline:1px solid var(--line)}}
    @media(max-width:360px){body{padding:18px}#google{overflow:hidden}}
    </style></head><body>
    <!-- THESIS: 기존 비밀번호 접속 방식과 담당자 전용 Google 확인만 연결한다.
    OWN-WORLD: 기존 GrowthHigh 잠금 화면의 중성색·작은 로고·340px 폭을 유지한다.
    STORY: 접속 → 서버 인증·기업 권한 확인 → 로그아웃. 데이터 공개는 다음 연결 검수 후다.
    FIRST VIEWPORT: 로고·제목·안내·비밀번호 또는 공식 Google 버튼·오류 안내.
    FORM: 기존 잠금 화면의 좁은 확장. FINISH: 로그인 검수 범위만 승인하며 기업 배포 완료로 해석하지 않는다. -->
    <main class="gt"><span class="mk"><img src="https://client.growthhigh.co.kr/assets/growthhigh-logo.png" alt="그로스하이"></span>
    <h1 id="gtitle">클라이언트 페이지</h1><p class="sub" id="gsub">담당 컨설턴트에게 받은 비밀번호를 입력해 주세요.</p>
    <div id="entry"><form id="gform"><input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호" required><button id="gbtn" type="submit">확인</button></form>
    <div id="staff-entry" hidden><div id="google"></div><button id="retry" type="button">Google 로그인 다시 준비</button></div></div>
    <section id="result" hidden aria-label="로그인 확인 결과"><p id="scope"></p><p class="sub">보안이 적용된 고객페이지입니다.</p><a id="openpage" href="/${slug}/page/" style="display:block;margin:0 0 18px;color:var(--accent)">고객페이지 열기</a><button id="logout" type="button">로그아웃</button></section>
    <section id="staff-tools" hidden><h2>고객 비밀번호 설정</h2><p class="sub">고객에게 전달할 비밀번호를 두 번 입력해 주세요.</p><form id="pwform"><input id="newpw" type="password" autocomplete="new-password" placeholder="새 비밀번호" required><input id="newpw2" type="password" autocomplete="new-password" placeholder="새 비밀번호 확인" required><button id="setpw" type="submit">비밀번호 저장</button></form><p class="ok" id="pwmsg" role="status" aria-live="polite"></p></section>
    <p class="msg" id="gmsg" role="status" aria-live="polite"></p></main>
    <script nonce="${nonce}">${LOGIN_SCRIPT}</script></body></html>`;
  return new Response(html, {headers:{
    'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client; style-src 'unsafe-inline' https://accounts.google.com/gsi/style; img-src https://client.growthhigh.co.kr https://*.googleusercontent.com data:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`,
    'x-content-type-options':'nosniff','x-frame-options':'DENY',
    'cross-origin-opener-policy':'same-origin-allow-popups',
    'referrer-policy':new URL(request.url).hostname === 'localhost' ? 'no-referrer-when-downgrade' : 'strict-origin-when-cross-origin'
  }});
}
