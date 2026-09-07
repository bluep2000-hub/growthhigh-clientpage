/**
 * 클라이언트 페이지의 편집 모드가 노션에 쓸 때 거치는 중계 서버.
 *
 * 노션 토큰은 이 서버 안에만 있다. 클라이언트 페이지는 주소만 알면 누구나
 * 열리므로, 화면 쪽에 토큰을 두면 워크스페이스 전체가 새어 나간다.
 *
 * 창구는 이것뿐이다. 노션에 쓰이는 모든 것이 여기를 지난다.
 *
 *   GET    /health         살아 있는지
 *   POST   /auth           담당자 공용 비밀번호가 맞는지
 *   GET    /notice/tree    편집 모드가 고칠 글을 통째로 받아 간다
 *   POST   /notice/save    고친 것을 한 번에 노션에 적용한다
 *   GET    /notice/item    그 항목을 고칠 때 입력칸에 넣을 글      (옛 방식, #25 에서 사라진다)
 *   PUT    /notice/item    그 항목을 고친다                        (옛 방식)
 *   POST   /notice/item    고른 섹션 안에 한 줄 보탠다             (옛 방식)
 *   DELETE /notice/item    그 항목을 지운다                        (옛 방식)
 */

import {
  ApiError, foreign, notFound, unauthorized, unprocessable, upstream,
} from "./error.js";
import { assertEditable, blockToHtml, markdownToRuns, runsToMarkdown } from "./markdown.js";
import {
  assertBlockInPage, createNotion, ensureNoticeDate, findNoticePage, HEADING_TYPES,
  ITEM_TYPES, listChildren, parentIdOf, sameId, SHELL_TYPES, walkChildren,
} from "./notion.js";
import { blockRuns, editHtmlToRuns, lockReason, runsToEditHtml } from "./richtext.js";
import { requestRebuild } from "./rebuild.js";

/** 클라이언트 페이지가 사는 곳. 여기서 오는 요청만 받는다.
    레포의 CNAME 이 client.growthhigh.co.kr 이라 실제 담당자는 그쪽으로 들어온다.
    github.io 주소는 그리로 301 되지만, 직접 열었을 때를 위해 남겨 둔다. */
const DEFAULT_ORIGINS = [
  "https://client.growthhigh.co.kr",
  "https://bluep2000-hub.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

function allowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return raw.length ? raw : DEFAULT_ORIGINS;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body, status, extra) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

/**
 * 담당자 공용 비밀번호 확인.
 *
 * 길이가 달라도 끝까지 훑는다. 첫 글자에서 바로 돌아오면 응답 시간만 재도
 * 한 글자씩 맞춰 나갈 수 있다.
 */
function passwordMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < given.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i % expected.length);
  }
  return diff === 0;
}

/**
 * 비밀번호는 base64(UTF-8) 로 실어 보낸다.
 *
 * HTTP 헤더는 바이트 하나가 한 글자다. 한글이 든 비밀번호를 그대로 넣으면
 * 브라우저가 요청을 만들다가 던진다 — 담당자가 비밀번호를 한글로 정하는 순간
 * 편집 모드가 통째로 죽는다. 값이 아니라 실어 보내는 방법의 문제라 여기서 푼다.
 */
function decodeBearer(raw) {
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function requireEditor(request, env) {
  const header = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const given = m && decodeBearer(m[1]);
  if (!given || !passwordMatches(given, env.EDITOR_PASSWORD || "")) {
    throw unauthorized();
  }
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (body && typeof body === "object") return body;
  } catch {
    /* 아래에서 422 */
  }
  throw unprocessable("JSON 본문이 필요합니다");
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw unprocessable(`${name} 가 필요합니다`);
  }
  return value.trim();
}

/** 빈 항목은 빌더가 버린다. 저장해 봐야 다음 빌드에서 사라지므로 여기서 막는다. */
function requireMarkdown(value) {
  if (typeof value !== "string") throw unprocessable("markdown 이 필요합니다");
  if (!value.trim()) throw unprocessable("빈 내용");
  return value;
}

/**
 * 슬러그와 블록 주소로 「고쳐도 되는 그 항목」을 집어 온다.
 *
 * 세 가지를 한꺼번에 확인한다 — 아는 슬러그인가, 그 기업의 공지 안에 있는
 * 블록인가, 글로 고칠 수 있는 항목인가. 쓰기 창구는 반드시 이걸 먼저 지난다.
 */
async function pickItem(nt, slug, blockId) {
  const notice = await findNoticePage(nt, slug);
  const block = await assertBlockInPage(nt, blockId, notice.pageId);
  if (!ITEM_TYPES.has(block.type)) {
    throw notFound(`${block.type} 은 공지 항목이 아닙니다`);
  }
  assertEditable(block);
  return { block, notice };
}

/** 고른 섹션. 안 골랐으면 빈 문자열 — 공지 맨 끝을 뜻한다. */
const requireSection = (v) => (typeof v === "string" ? v.trim() : "");

/** 보탠 줄의 생김새. 공지는 대부분 글머리 기호라 그 모양으로 붙인다. */
const NEW_ITEM_TYPE = "bulleted_list_item";

/**
 * 제목 없이 시작하는 첫 구역. 열어 준 제목이 없어 주소로 부를 수 없다.
 * 빌더가 봉투에 이 이름으로 싣는다 — `build_client.py` 의 `flush_into`.
 *
 * 아래 `{ type: "start" }` 와 글자가 같지만 남이다. 그쪽은 「이 그릇의 맨
 * 앞」을 뜻하는 노션 API 의 낱말이다.
 */
const SECTION_TOP = "start";

/** 그릇 하나가 섹션 제목을 품고 있는가. 빌더가 펴서 읽는 그릇만 들여다본다. */
async function holdsHeading(nt, block) {
  if (!block.has_children || !SHELL_TYPES.has(block.type)) return false;
  return (await listChildren(nt, block.id)).some((k) => HEADING_TYPES.has(k.type));
}

/**
 * 제목 없이 시작하는 첫 구역의 끝자리. 첫 제목 앞에서 끝난다.
 *
 * 제목이 그릇 안에 있으면 그 그릇 앞이다 — 그릇을 헤집고 들어가 붙이면
 * 머리말이 남의 섹션 안으로 들어간다.
 */
async function topSpot(nt, pageId) {
  const kids = await listChildren(nt, pageId);
  let last = null;
  for (const b of kids) {
    if (HEADING_TYPES.has(b.type) || await holdsHeading(nt, b)) break;
    last = b;
  }
  return { parentId: pageId,
           position: last ? { type: "after_block", after_block: { id: last.id } }
                          : { type: "start" } };
}

/**
 * 보탠 줄을 어디에 놓을지. 섹션을 고르지 않았으면 null — 공지 맨 끝이다.
 *
 * 노션은 이미 있는 블록을 옮기지 못한다. 그래서 맨 끝에 붙였다가 끌어
 * 올리는 길이 없고, 처음부터 그 자리에 넣어야 한다. 붙일 자리를 고르는 것은
 * 받아 준다 — `position: {type:"after_block"}`.
 *
 * **제목은 공지 페이지 바로 밑에 있지 않을 때가 더 많다.** 실제 공지를 재어
 * 보니 위프코리아는 최상위 제목이 0개이고 다섯이 전부 콜아웃 안에 있었다.
 * 그래서 최상위만 훑으면 멀쩡한 섹션이 통째로 「남의 것」이 된다. 제목이 든
 * 그릇을 찾아 그 안에서 자리를 세고, 보탠 줄도 그 그릇에 남긴다.
 *
 * 자리를 여기서 세는 까닭은 순서를 아는 곳이 노션뿐이기 때문이다.
 * `GET /notice/tree` 는 주소를 열쇠로 한 뭉치라 순서를 담지 않고, 봉투의
 * 순서는 지난 빌드의 것이다.
 *
 * @returns {Promise<{parentId: string, position: object}|null>}
 */
async function sectionSpot(nt, pageId, sectionId) {
  if (!sectionId) return null;
  if (sectionId === SECTION_TOP) return topSpot(nt, pageId);

  // 이 공지 안의 블록인가. 아니면 여기서 통째로 거절한다 — 주소 하나로
  // 워크스페이스의 아무 데나 줄을 심을 수 있게 두지 않는다.
  const head = await assertBlockInPage(nt, sectionId, pageId);
  if (!HEADING_TYPES.has(head.type)) throw unprocessable("섹션 제목이 아닙니다");

  // 제목 다음부터 다음 제목 앞까지가 그 섹션이다. 그 마지막 뒤에 붙이고,
  // 섹션이 비어 있으면 제목 자신이 그 자리다.
  const parentId = parentIdOf(head);
  const kids = await listChildren(nt, parentId);
  const at = kids.findIndex((b) => sameId(b.id, sectionId));
  if (at < 0) throw upstream("제목을 그 그릇에서 찾지 못했습니다");

  let last = at;
  for (let i = at + 1; i < kids.length && !HEADING_TYPES.has(kids[i].type); i += 1) {
    last = i;
  }
  return { parentId,
           position: { type: "after_block", after_block: { id: kids[last].id } } };
}

/** 날짜를 채웠을 때만 알려 준다. 평소 응답에 null 을 얹지 않는다. */
const withDate = (body, dated) => (dated ? { ...body, dated } : body);

/**
 * 쓰기에 성공한 뒤에만 부른다.
 *
 * 신호가 실패해도 담당자의 저장은 성공이다 — 노션에는 이미 들어갔고 다음
 * 빌드가 가져간다. 여기서 응답을 실패로 돌리면 담당자는 같은 글을 두 번
 * 저장하게 된다.
 */
async function signalRebuild(env, slug, body) {
  const rebuild = await requestRebuild(env, slug);
  return rebuild === "sent" ? body : { ...body, rebuild };
}

/* ─────────────────────── 공지 전체를 읽고, 한 번에 저장한다 ─────────────────────── */

/**
 * 한 번의 `GET /notice/tree` 가 쓸 자식 조회 횟수. 까닭은 `walkChildren` 을 본다.
 * 공지를 찾아가는 데 이미 세 번을 쓰므로 그만큼 여유를 둔 값이다.
 */
const TREE_BUDGET = 40;

/**
 * 한 번의 저장이 받는 변경 수. 바깥 호출 상한 때문에 둔다 — 변경 하나가
 * 조회 한 번에 쓰기 한 번이라, 스무 개면 공지를 찾아가는 세 번을 더해
 * 무료 상한에 닿는다.
 *
 * 재빌드 신호는 **요청 하나에 한 번**이다. 화면이 여기 걸려 저장을 쪼개면
 * 쪼갠 수만큼 신호가 나간다. 미팅 뒤에 고치는 줄은 열 줄을 넘지 않아 실제로는
 * 닿지 않지만, 넘으면 쪼개는 대신 담당자에게 알리는 편이 낫다.
 */
const SAVE_MAX_CHANGES = 20;

/** 이 티켓이 다루는 변경. 보태기·지우기·옮기기·표는 뒤 티켓에서 붙는다. */
const SAVE_OPS = new Set(["edit", "check"]);

/**
 * 편집 모드가 한 항목에 대해 알아야 할 전부.
 *
 * `last_edited_time` 이 저장할 때 보내는 `seen` 의 기준선이다. 봉투에 실린
 * 시각을 기준선으로 쓰면 안 된다 — 그것은 빌드 시각이라, 지난 빌드 이후
 * 노션에서 손댄 항목이 전부 어긋남으로 잡힌다.
 */
function treeItem(block) {
  const out = { type: block.type, last_edited_time: block.last_edited_time };
  if (ITEM_TYPES.has(block.type)) out.html = runsToEditHtml(blockRuns(block));
  if (block.type === "to_do") out.checked = Boolean(block.to_do?.checked);
  const reason = lockReason(block);
  if (reason) out.locked = reason;
  return out;
}

/** 「더 볼 곳」 목록. 쉼표로 붙여 오고, 없으면 공지 페이지부터 시작한다. */
function treeRoots(raw, pageId) {
  const ids = String(raw || "").split(",").map((v) => v.trim()).filter(Boolean);
  return ids.length ? ids : [pageId];
}

/**
 * 변경 하나를 살펴본다. **노션에 쓰지 않는다.**
 *
 * 저장은 두 단계다 — 전부 살펴본 다음에 하나씩 쓴다. 살펴보기를 먼저 다
 * 끝내는 이유는 딱 하나, **남의 기업 블록 주소**다. 그것은 실수가 아니라
 * 넘겨짚기여서 저장 전체를 거절하는데, 쓰면서 확인하면 앞의 몇 줄은 이미
 * 노션에 들어간 뒤가 된다.
 *
 * 그 밖의 실패는 걸러 두었다가 결과로 돌려준다. 하나가 실패했다고 나머지를
 * 멈추면 담당자는 관계없는 줄까지 다시 적어야 하고, 전부 취소인 척하면
 * 거짓말이 된다 — 노션에는 되돌리기가 없다.
 */
async function inspectChange(nt, notice, change, index, ancestors) {
  const blockId = typeof change?.blockId === "string" ? change.blockId.trim() : "";
  const at = { index, blockId };
  const fail = (detail) => ({ ...at, result: { ...at, status: "failed", detail } });

  try {
    if (!SAVE_OPS.has(change?.op)) return fail(`모르는 변경: ${change?.op}`);
    if (!blockId) return fail("blockId 가 필요합니다");
    const seen = requireText(change.seen, "seen");

    const block = await assertBlockInPage(nt, blockId, notice.pageId, ancestors);
    if (!ITEM_TYPES.has(block.type)) return fail(`${block.type} 은 공지 항목이 아닙니다`);

    // 화면이 본 뒤에 노션에서 먼저 바뀌었으면 쓰지 않는다. 노션에 조건부
    // 쓰기가 없어 읽기와 쓰기 사이의 틈은 남지만, 다른 담당자가 방금 적은
    // 것을 통째로 덮어쓰는 일은 이것으로 막힌다.
    if (block.last_edited_time !== seen) {
      return { ...at, result: { ...at, status: "stale", current: treeItem(block) } };
    }

    if (change.op === "check") {
      // 체크는 rich_text 를 건드리지 않는다. 그래서 잠긴 항목도 체크는 된다 —
      // 링크 카드가 든 할 일에 표시하려고 노션을 열게 하지 않는다.
      if (block.type !== "to_do") return fail(`${block.type} 은 할 일 항목이 아닙니다`);
      return { ...at, patch: { to_do: { checked: Boolean(change.checked) } } };
    }

    const reason = lockReason(block);
    if (reason) return { ...at, result: { ...at, status: "locked", detail: reason } };

    // 불투명 조각은 방금 읽은 이 블록에서 꺼낸다. 화면은 자리만 돌려주고,
    // 노션에 들어가는 값은 노션에 있던 값 그대로다.
    const runs = editHtmlToRuns(change.html, blockRuns(block));
    return { ...at, patch: { [block.type]: { rich_text: runs } } };
  } catch (e) {
    if (e instanceof ApiError && e.code === "not_mine") throw e;
    if (e instanceof ApiError) return fail(e.detail || e.code);
    throw e;
  }
}

/** 살펴본 것을 노션에 쓴다. 쓰다 실패해도 나머지는 계속 간다. */
async function writeChange(nt, prepared) {
  const at = { index: prepared.index, blockId: prepared.blockId };
  try {
    const updated = await nt.patch(`/blocks/${prepared.blockId}`, prepared.patch);
    return { ...at, status: "ok", ...treeItem(updated) };
  } catch (e) {
    if (e instanceof ApiError) return { ...at, status: "failed", detail: e.detail || e.code };
    throw e;
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/health" && method === "GET") {
    return json({ ok: true, service: "growthhigh-clientpage-relay" }, 200);
  }

  if (pathname === "/auth" && method === "POST") {
    requireEditor(request, env);
    return json({ ok: true }, 200);
  }

  if (pathname === "/notice/tree" && method === "GET") {
    requireEditor(request, env);
    const slug = requireText(url.searchParams.get("slug"), "slug");

    const nt = createNotion(env);
    // 슬러그로 찾는다. 화면이 페이지 주소를 대는 대로 열어 주면, 주소 하나로
    // 워크스페이스의 아무 페이지나 읽을 수 있게 된다.
    const notice = await findNoticePage(nt, slug);
    const roots = treeRoots(url.searchParams.get("more"), notice.pageId);
    const { blocks, more } = await walkChildren(nt, roots, TREE_BUDGET);

    const items = {};
    for (const b of blocks) items[b.id] = treeItem(b);
    return json({ pageId: notice.pageId, items, more }, 200);
  }

  if (pathname === "/notice/save" && method === "POST") {
    requireEditor(request, env);
    const body = await readJson(request);
    const slug = requireText(body.slug, "slug");
    const changes = body.changes;
    if (!Array.isArray(changes) || !changes.length) {
      throw unprocessable("changes 가 필요합니다");
    }
    if (changes.length > SAVE_MAX_CHANGES) {
      throw unprocessable(`한 번에 ${SAVE_MAX_CHANGES}개까지 보냅니다`);
    }

    const nt = createNotion(env);
    const notice = await findNoticePage(nt, slug);
    // 화면이 열어 둔 사이에 누가 새 공지를 만들었으면, 지금 페이지에 뜨는
    // 공지는 다른 것이다. 그대로 쓰면 클라이언트에게 보이지 않는 공지를 고친다.
    if (body.noticePageId && !sameId(body.noticePageId, notice.pageId)) {
      throw notFound("화면이 보던 공지가 더 이상 가장 최근 공지가 아닙니다");
    }

    // ① 전부 살펴본다. 남의 기업 주소가 섞여 있으면 여기서 통째로 멈춘다.
    const ancestors = new Map();
    const prepared = [];
    for (let i = 0; i < changes.length; i += 1) {
      prepared.push(await inspectChange(nt, notice, changes[i], i, ancestors));
    }

    // ② 통과한 것만 하나씩 쓴다.
    const results = [];
    for (const p of prepared) {
      results.push(p.result ?? await writeChange(nt, p));
    }
    const saved = results.filter((r) => r.status === "ok").length;

    // 아무것도 쓰지 못했으면 신호를 던지지 않는다. 던지면 바뀐 것 없는 빌드가
    // 한 번 돌고, 담당자는 실패한 저장을 「1~2분 뒤 반영」으로 읽는다.
    let rebuild = "skipped";
    if (saved) {
      await ensureNoticeDate(nt, notice);
      rebuild = await requestRebuild(env, slug);
    }
    return json({ pageId: notice.pageId, results,
                  saved, failed: results.length - saved, rebuild }, 200);
  }

  if (pathname === "/notice/item" && method === "GET") {
    requireEditor(request, env);
    const slug = requireText(url.searchParams.get("slug"), "slug");
    const blockId = requireText(url.searchParams.get("blockId"), "blockId");

    const nt = createNotion(env);
    const { block } = await pickItem(nt, slug, blockId);
    // 화면에 보이는 글이 아니라 노션에 있는 글을 준다. 빌드가 후행 콜론을
    // 떼기 때문에 둘이 다를 수 있고, 보이는 대로 저장하면 그만큼 사라진다.
    return json({
      markdown: runsToMarkdown(blockRuns(block)),
      html: blockToHtml(block),
      type: block.type,
    }, 200);
  }

  if (pathname === "/notice/item" && method === "PUT") {
    requireEditor(request, env);
    const body = await readJson(request);
    const slug = requireText(body.slug, "slug");
    const blockId = requireText(body.blockId, "blockId");
    const runs = markdownToRuns(requireMarkdown(body.markdown));

    const nt = createNotion(env);
    const { block, notice } = await pickItem(nt, slug, blockId);

    const updated = await nt.patch(`/blocks/${blockId}`, {
      [block.type]: { rich_text: runs },
    });
    const dated = await ensureNoticeDate(nt, notice);
    return json(await signalRebuild(env, slug, withDate({ html: blockToHtml(updated) }, dated)), 200);
  }

  if (pathname === "/notice/item" && method === "POST") {
    requireEditor(request, env);
    const body = await readJson(request);
    const slug = requireText(body.slug, "slug");
    const runs = markdownToRuns(requireMarkdown(body.markdown));

    const nt = createNotion(env);
    // 새 공지(새 행)는 만들지 않는다. 가장 최근 공지 안에 한 줄 붙일 뿐이다.
    const notice = await findNoticePage(nt, slug);
    const spot = await sectionSpot(nt, notice.pageId, requireSection(body.sectionId));
    const res = await nt.patch(`/blocks/${spot ? spot.parentId : notice.pageId}/children`, {
      children: [{ object: "block", type: NEW_ITEM_TYPE,
                   [NEW_ITEM_TYPE]: { rich_text: runs } }],
      ...(spot ? { position: spot.position } : {}),
    });
    const made = (res.results || [])[0];
    if (!made) throw upstream("노션이 새 줄을 돌려주지 않았습니다");

    const dated = await ensureNoticeDate(nt, notice);
    return json(await signalRebuild(env, slug,
      withDate({ blockId: made.id, html: blockToHtml(made) }, dated)), 201);
  }

  if (pathname === "/notice/item" && method === "DELETE") {
    requireEditor(request, env);
    const body = await readJson(request);
    const slug = requireText(body.slug, "slug");
    const blockId = requireText(body.blockId, "blockId");

    const nt = createNotion(env);
    // 고치기와 같은 확인을 거친다. 잠긴 항목은 지우지도 못한다 —
    // 첨부가 든 줄을 여기서 지우면 노션에서 파일이 통째로 사라진다.
    await pickItem(nt, slug, blockId);
    await nt.del(`/blocks/${blockId}`);
    await requestRebuild(env, slug);
    return new Response(null, { status: 204 });
  }

  throw notFound(pathname);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const res = await route(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof ApiError) {
        return json({ error: e.code, detail: e.detail }, e.status, cors);
      }
      // 여기 오는 것은 예상 못 한 것이다. 사유를 밖으로 내보내지 않는다.
      console.error(e);
      return json({ error: "internal" }, 500, cors);
    }
  },
};
