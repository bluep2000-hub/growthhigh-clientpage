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
 *   GET    /notice/item    그 항목을 고칠 때 입력칸에 넣을 글
 *   PUT    /notice/item    그 항목을 고친다
 */

import { ApiError, notFound, unauthorized, unprocessable } from "./error.js";
import {
  assertEditable, blockRuns, blockToHtml, markdownToRuns, runsToMarkdown,
} from "./markdown.js";
import { assertBlockInPage, createNotion, findNoticePage, ITEM_TYPES } from "./notion.js";

/** 클라이언트 페이지가 사는 곳. 여기서 오는 요청만 받는다. */
const DEFAULT_ORIGINS = [
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

/**
 * 슬러그와 블록 주소로 「고쳐도 되는 그 항목」을 집어 온다.
 *
 * 세 가지를 한꺼번에 확인한다 — 아는 슬러그인가, 그 기업의 공지 안에 있는
 * 블록인가, 글로 고칠 수 있는 항목인가. 쓰기 창구는 반드시 이걸 먼저 지난다.
 */
async function pickItem(nt, slug, blockId) {
  const pageId = await findNoticePage(nt, slug);
  const block = await assertBlockInPage(nt, blockId, pageId);
  if (!ITEM_TYPES.has(block.type)) {
    throw notFound(`${block.type} 은 공지 항목이 아닙니다`);
  }
  assertEditable(block);
  return block;
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

  if (pathname === "/notice/item" && method === "GET") {
    requireEditor(request, env);
    const slug = requireText(url.searchParams.get("slug"), "slug");
    const blockId = requireText(url.searchParams.get("blockId"), "blockId");

    const nt = createNotion(env);
    const block = await pickItem(nt, slug, blockId);
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
    if (typeof body.markdown !== "string") throw unprocessable("markdown 이 필요합니다");
    // 빈 항목은 빌더가 버린다. 저장해 봐야 다음 빌드에서 사라지므로 여기서 막는다.
    if (!body.markdown.trim()) throw unprocessable("빈 내용");

    const nt = createNotion(env);
    const block = await pickItem(nt, slug, blockId);
    const runs = markdownToRuns(body.markdown);

    const updated = await nt.patch(`/blocks/${blockId}`, {
      [block.type]: { rich_text: runs },
    });
    return json({ html: blockToHtml(updated) }, 200);
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
