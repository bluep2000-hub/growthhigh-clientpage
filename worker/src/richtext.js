/**
 * 노션 `rich_text` ↔ 편집용 HTML.
 *
 * 예전에는 마크다운으로 왕복했다. 마크다운이 링크·글자색·커스텀 이모지를
 * 담지 못해, 그런 것이 든 항목은 전부 잠긴 항목이 되었다 — 고쳐 저장하는
 * 순간 그만큼이 노션에서 사라지기 때문이다. 그릇을 HTML 로 바꾸면 그 잠금이
 * 그 자체로 사라진다.
 *
 * 두 가지 방식으로 지킨다.
 *
 * - **화면이 만들 수 있는 것**(굵게·기울임·밑줄·취소선·코드·링크)은 태그로
 *   싣는다. 담당자가 고치면 고친 대로 노션에 들어간다.
 * - **화면이 만들 수 없는 것**(멘션·수식)은 **불투명 조각**으로 싣는다.
 *   화면은 손대지 않고 그대로 돌려주기만 하고, 여기서는 「내가 넘긴 그대로
 *   돌아왔는가」만 본다. 통과하면 노션에 있던 것을 그대로 다시 쓴다.
 *
 * 글자색은 그 중간이다. 고르개는 만들지 않지만(#18 「색 고르개는 넣지 않는다」)
 * 이미 칠해진 색은 태그의 값으로 실어 두어, 담당자가 그 글을 고쳐도 색이
 * 남는다. 불투명 조각으로 만들면 색칠된 글은 고칠 수 없게 된다.
 */

import { unprocessable } from "./error.js";
import { ITEM_TYPES } from "./notion.js";

/** 노션이 받아 주는 색 이름. 이 밖의 값이 돌아오면 거절한다. */
export const COLORS = new Set([
  "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
  "default_background", "gray_background", "brown_background", "orange_background",
  "yellow_background", "green_background", "blue_background", "purple_background",
  "pink_background", "red_background",
]);

const BLANK = { bold: false, italic: false, strikethrough: false,
                underline: false, code: false, color: "default" };

/** 노션은 rich_text 한 조각을 2000자까지만 받는다. 넘으면 400 이 떨어진다. */
const CHUNK = 2000;

/** 링크에 넣을 수 있는 주소. `javascript:` 같은 것을 노션에 심지 않는다. */
const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * 통째로 잠기는 블록.
 *
 * 링크 카드와 하위 문서는 영영 잠긴다 — 노션이 `link_preview` 쓰기를 받지
 * 않고, 하위 문서는 페이지 편집기가 따로 필요하다. 나머지 다섯은 **아직**
 * 다루는 코드가 없어서 잠근다. 표는 #26 이, 첨부·그림·코드·구분선은 #27 이
 * 열면서 여기서 지운다.
 */
export const BLOCK_LOCK = {
  link_preview: "링크 카드",
  child_page: "문서",
  table: "표",
  code: "코드",
  image: "그림",
  file: "첨부",
  divider: "구분선",
};

/** 노션이 쓰기를 받지 않는 멘션. 이것이 든 항목은 글로 고칠 수 없다. */
const READONLY_MENTIONS = new Set(["link_mention", "link_preview"]);

/** 노션 블록의 rich_text. 타입마다 자리가 달라 블록 타입을 거쳐 꺼낸다. */
export function blockRuns(block) {
  const body = block?.[block?.type];
  return Array.isArray(body?.rich_text) ? body.rich_text : [];
}

/**
 * 조각의 글자.
 *
 * 노션에서 **읽은** 조각은 `plain_text` 를 달고 오고, 노션에 **쓰려고** 지은
 * 조각은 `text.content` 에만 글을 담는다. 둘 다 받아야 편집용 HTML 을 읽어
 * 다시 편집용 HTML 로 되돌리는 길이 열린다 — 공지 저장소가 글을 다듬을 때
 * 그 길로 지나간다(`doc.js`).
 */
const runText = (r) => r?.plain_text ?? r?.text?.content ?? "";

/** 조각이 매달고 있는 링크. 위와 같은 까닭으로 두 자리를 다 본다. */
const runHref = (r) => r?.href ?? r?.text?.link?.url ?? null;

/** 화면이 글로 만들어 낼 수 없는 조각. 그대로 돌려받는 수밖에 없다. */
function isOpaque(run) {
  return run?.type === "mention" || run?.type === "equation";
}

/**
 * 이 블록을 클라이언트 페이지에서 고칠 수 없게 만드는 것. 없으면 null.
 *
 * **빌더의 `lock_reason()` 과 아직 다르다.** 빌더는 이모지·링크·글자색이 든
 * 항목까지 잠근다 — 화면이 아직 옛 마크다운 길로 고치고, 그 길은 그것들을
 * 담지 못하기 때문이다. 지금 그 판정을 좁히면 담당자는 열리는 줄을 고치다
 * 옛 창구에서 거절당한다.
 *
 * 편집 모드는 봉투의 `locked` 가 아니라 `GET /notice/tree` 가 주는 이 값을
 * 쓴다(#21). 옛 길이 사라지고(#25) 표·첨부까지 열리면(#26·#27) 둘은 같아진다.
 */
export function lockReason(block) {
  const type = block?.type;
  if (BLOCK_LOCK[type]) return BLOCK_LOCK[type];
  if (!ITEM_TYPES.has(type)) return "노션 전용";
  for (const r of blockRuns(block)) {
    if (r?.type === "mention" && READONLY_MENTIONS.has(r.mention?.type)) return "링크 카드";
  }
  return null;
}

/* ────────────────────────────── 내보내기 ────────────────────────────── */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** 노션 텍스트는 반드시 이스케이프한다. 빌더의 `esc()` 와 같다. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** 줄바꿈은 태그로 싣는다. 그냥 두면 편집기가 공백으로 뭉갠다. */
function escText(s) {
  return esc(s).replace(/\n/g, "<br>");
}

/**
 * rich_text → 편집용 HTML.
 *
 * 감싸는 순서는 고정이다 — 안쪽부터 코드 → 밑줄 → 기울임 → 취소선 → 굵게 →
 * 색 → 링크. 되읽기가 순서를 따지지는 않지만, 순서가 흔들리면 왕복이
 * 무손실인지 눈으로 확인할 수 없다.
 *
 * 불투명 조각은 `data-o` 에 **지금 rich_text 에서의 자리**를 적어 보낸다.
 * 저장할 때 서버가 그 블록을 다시 읽어 같은 자리의 조각을 그대로 쓴다.
 * 자리를 열쇠로 쓸 수 있는 것은, 저장 직전에 「화면이 본 시각」이 노션의 지금
 * 시각과 같은지 먼저 보기 때문이다 — 다르면 쓰지 않고 어긋남으로 돌려준다.
 */
export function runsToEditHtml(runs) {
  let out = "";
  (runs || []).forEach((r, i) => {
    if (isOpaque(r)) {
      out += `<span data-o="${i}">${escText(runText(r))}</span>`;
      return;
    }
    const t = runText(r);
    if (!t) return;
    const a = r.annotations || {};
    let h = escText(t);
    if (a.code) h = `<code>${h}</code>`;
    if (a.underline) h = `<u>${h}</u>`;
    if (a.italic) h = `<em>${h}</em>`;
    if (a.strikethrough) h = `<s>${h}</s>`;
    if (a.bold) h = `<strong>${h}</strong>`;
    const color = a.color || "default";
    if (color !== "default") h = `<span data-c="${esc(color)}">${h}</span>`;
    const href = runHref(r);
    if (href) h = `<a href="${esc(href)}">${h}</a>`;
    out += h;
  });
  return out;
}

/* ────────────────────────────── 되읽기 ────────────────────────────── */

/** 같은 뜻의 태그를 둘 다 받는다. 편집기가 무엇을 내놓든 받아들이기 위해서다. */
const ANNOTATION_TAGS = {
  strong: "bold", b: "bold",
  em: "italic", i: "italic",
  u: "underline",
  s: "strikethrough", del: "strikethrough", strike: "strikethrough",
  code: "code",
};

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

function attrs(raw) {
  const out = {};
  for (const m of raw.matchAll(/([a-z][a-z0-9-]*)\s*=\s*"([^"]*)"/gi)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2]);
  }
  return out;
}

/**
 * 노션에 있던 조각을 다시 쓸 수 있는 모양으로.
 *
 * 읽을 때 오는 모양(`name`·`url`·`plain_text` 가 붙어 있다)을 그대로 되돌려
 * 보내면 노션이 거절한다. 쓰기가 요구하는 최소한만 남긴다.
 */
function opaqueToWrite(r) {
  const annotations = { ...BLANK, ...(r.annotations || {}) };
  if (r.type === "equation") {
    return { type: "equation", equation: { expression: r.equation?.expression ?? "" },
             annotations };
  }
  const m = r.mention || {};
  const id = m[m.type]?.id;
  switch (m.type) {
    case "custom_emoji":
      return { type: "mention", mention: { type: "custom_emoji", custom_emoji: { id } },
               annotations };
    case "user":
      return { type: "mention", mention: { type: "user", user: { object: "user", id } },
               annotations };
    case "page":
      return { type: "mention", mention: { type: "page", page: { id } }, annotations };
    case "database":
      return { type: "mention", mention: { type: "database", database: { id } }, annotations };
    case "date":
      return { type: "mention", mention: { type: "date", date: m.date }, annotations };
    default:
      // 링크 카드가 여기까지 오는 일은 없다 — 그 항목은 잠겨 있다. 그래도
      // 조용히 흘려보내지 않는다. 흘려보내면 그 조각이 노션에서 사라진다.
      throw unprocessable(`되돌려 쓸 수 없는 조각: ${m.type || r.type}`);
  }
}

/**
 * 편집용 HTML → rich_text.
 *
 * 아는 태그만 받는다. 모르는 태그·닫히지 않은 태그·엇갈린 태그는 전부
 * 거절한다 — 짐작해서 고쳐 주면 담당자가 의도한 것과 다른 글이 노션에 남는다.
 *
 * @param {string} html
 * @param {object[]} sourceRuns 지금 노션에 있는 rich_text. 불투명 조각을 이것에서 꺼낸다.
 */
export function editHtmlToRuns(html, sourceRuns = []) {
  if (typeof html !== "string") throw unprocessable("html 이 필요합니다");

  const runs = [];
  const stack = [];                 // 열려 있는 태그 { name, kind }
  const on = { bold: 0, italic: 0, underline: 0, strikethrough: 0, code: 0 };
  const hrefs = [];
  const colors = [];
  let buf = "";
  let opaque = null;                // 불투명 조각 안에 있으면 { index, text }

  const flush = () => {
    const text = decodeEntities(buf);
    buf = "";
    if (!text) return;
    const annotations = {
      ...BLANK,
      bold: on.bold > 0, italic: on.italic > 0, underline: on.underline > 0,
      strikethrough: on.strikethrough > 0, code: on.code > 0,
      color: colors.length ? colors[colors.length - 1] : "default",
    };
    const link = hrefs.length ? { url: hrefs[hrefs.length - 1] } : null;
    for (let at = 0; at < text.length; at += CHUNK) {
      runs.push({ type: "text", text: { content: text.slice(at, at + CHUNK), link },
                  annotations });
    }
  };

  const openTag = (name, raw) => {
    if (name === "br") {
      buf += "\n";
      return;
    }
    flush();
    if (ANNOTATION_TAGS[name]) {
      on[ANNOTATION_TAGS[name]] += 1;
      stack.push({ name, kind: "annotation" });
      return;
    }
    if (name === "a") {
      const href = attrs(raw).href || "";
      if (!SAFE_SCHEME.test(href)) throw unprocessable(`받을 수 없는 주소: ${href}`);
      hrefs.push(href);
      stack.push({ name, kind: "link" });
      return;
    }
    if (name === "span") {
      const a = attrs(raw);
      if (a["data-o"] !== undefined) {
        const index = Number(a["data-o"]);
        if (!Number.isInteger(index) || index < 0) {
          throw unprocessable("불투명 조각의 자리가 잘못되었습니다");
        }
        opaque = { index, text: "" };
        stack.push({ name, kind: "opaque" });
        return;
      }
      const color = a["data-c"] ?? "default";
      if (!COLORS.has(color)) throw unprocessable(`모르는 색: ${color}`);
      colors.push(color);
      stack.push({ name, kind: "color" });
      return;
    }
    throw unprocessable(`모르는 태그: ${name}`);
  };

  const closeTag = (name) => {
    const top = stack.pop();
    if (!top || top.name !== name) throw unprocessable(`엇갈린 태그: ${name}`);
    if (top.kind === "annotation") {
      flush();
      on[ANNOTATION_TAGS[name]] -= 1;
      return;
    }
    if (top.kind === "link") {
      flush();
      hrefs.pop();
      return;
    }
    if (top.kind === "color") {
      flush();
      colors.pop();
      return;
    }
    // 불투명 조각 — 내가 넘긴 그대로 돌아왔을 때만 통과시킨다.
    const src = sourceRuns[opaque.index];
    if (!src || !isOpaque(src)) {
      throw unprocessable(`없는 불투명 조각: ${opaque.index}`);
    }
    if (decodeEntities(opaque.text) !== (src.plain_text ?? "")) {
      throw unprocessable("불투명 조각이 손대어졌습니다");
    }
    runs.push(opaqueToWrite(src));
    opaque = null;
  };

  for (let i = 0; i < html.length; ) {
    const c = html[i];
    if (c !== "<") {
      if (opaque) opaque.text += c;
      else buf += c;
      i += 1;
      continue;
    }
    const end = html.indexOf(">", i);
    if (end < 0) throw unprocessable("닫히지 않은 태그");
    const raw = html.slice(i + 1, end);
    i = end + 1;

    const closing = raw[0] === "/";
    const m = /^\/?\s*([a-z][a-z0-9]*)([\s\S]*?)\/?$/i.exec(raw);
    if (!m) throw unprocessable(`읽을 수 없는 태그: <${raw}>`);
    const name = m[1].toLowerCase();

    // 불투명 조각 안에서는 서식을 받지 않는다. 닫는 span 과, 줄바꿈을 싣고
    // 온 <br> 뿐이다 — 조각의 글에 줄바꿈이 있으면 그것으로 나갔다 돌아온다.
    if (opaque) {
      if (name === "br" && !closing) {
        opaque.text += "\n";
        continue;
      }
      if (!(closing && name === "span")) {
        throw unprocessable("불투명 조각 안에는 서식을 넣을 수 없습니다");
      }
    }
    if (closing) closeTag(name);
    else openTag(name, m[2]);
  }

  if (opaque) throw unprocessable("닫히지 않은 불투명 조각");
  if (stack.length) throw unprocessable(`닫히지 않은 태그: ${stack[stack.length - 1].name}`);
  flush();

  // 빈 항목은 빌더가 버린다. 저장해 봐야 다음 빌드에서 사라지므로 여기서 막는다.
  if (!runs.length) throw unprocessable("빈 내용");
  return runs;
}
