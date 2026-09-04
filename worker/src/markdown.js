/**
 * 마크다운 ↔ 노션 rich_text, 그리고 rich_text → HTML.
 *
 * 화면은 변환을 모른다. 담당자가 적은 글을 노션 서식으로 바꾸는 일도, 저장한
 * 결과를 화면에 그릴 HTML 로 바꾸는 일도 여기서만 한다.
 *
 * HTML 은 빌더(`src/build_client.py` 의 `runs_to_html`)와 **같은 모양**이어야
 * 한다. 다르면 저장 직후 담당자가 보는 줄과 1~2분 뒤 다시 만들어진 줄이
 * 어긋나고, 담당자는 자기가 뭘 저장했는지 믿을 수 없게 된다.
 */

import { locked, unprocessable } from "./error.js";

/**
 * 글로 적어 되돌릴 수 있는 서식. 이 밖의 것이 든 항목은 잠긴 항목이다.
 * 빌더의 `EDITABLE_ANNOTATIONS` 와 반드시 같아야 한다 — 빌더가 주소를 실어
 * 보낸 항목을 여기서 거절하면 담당자는 이유를 알 수 없다.
 */
const EDITABLE = new Set(["bold", "strikethrough", "code"]);

/** rich_text 항목이 커스텀 이모지 멘션이면 참. 글로 쓰면 `:이름:` 이 된다. */
function isCustomEmoji(run) {
  return run?.type === "mention" && run?.mention?.type === "custom_emoji";
}

/**
 * 이 블록을 고칠 수 없게 만드는 것. 없으면 null.
 * 빌더의 `lock_reason()` 과 같은 판정이다.
 */
export function lockReason(block) {
  for (const r of blockRuns(block)) {
    if (isCustomEmoji(r)) return "이모지";
    if (r.href) return "링크";
    const a = r.annotations || {};
    for (const k of Object.keys(a)) {
      if (k === "color") continue;
      if (a[k] && !EDITABLE.has(k)) return "서식";
    }
    if ((a.color || "default") !== "default") return "글자색";
  }
  return null;
}

/** 노션 블록의 rich_text. 타입마다 자리가 달라 블록 타입을 거쳐 꺼낸다. */
export function blockRuns(block) {
  const body = block?.[block?.type];
  return Array.isArray(body?.rich_text) ? body.rich_text : [];
}

/* ────────────────────────── rich_text → 마크다운 ────────────────────────── */

const MD_SPECIAL = /[\\*~`]/g;

/** 마크다운 표시로 읽힐 글자를 그대로 보이게 한다. */
function escapeMd(text) {
  return text.replace(MD_SPECIAL, (c) => `\\${c}`);
}

/**
 * 담당자가 입력칸에서 보게 될 글. 안쪽부터 코드 → 취소선 → 굵게 순으로 감싼다.
 * 이 순서는 `runsToHtml` 의 중첩 순서와 같아야 왕복이 어긋나지 않는다.
 */
export function runsToMarkdown(runs) {
  let out = "";
  for (const r of runs) {
    const text = r.plain_text ?? "";
    if (!text) continue;
    const a = r.annotations || {};
    let s = escapeMd(text);
    if (a.code) s = `\`${s}\``;
    if (a.strikethrough) s = `~~${s}~~`;
    if (a.bold) s = `**${s}**`;
    out += s;
  }
  return out;
}

/* ────────────────────────── 마크다운 → rich_text ────────────────────────── */

const MARKERS = [
  { mark: "`", key: "code" },
  { mark: "**", key: "bold" },
  { mark: "~~", key: "strikethrough" },
];

const BLANK = { bold: false, italic: false, strikethrough: false,
                underline: false, code: false, color: "default" };

/**
 * 담당자가 적은 글을 노션 rich_text 로.
 *
 * 다루는 표시는 셋뿐이다 — `` `코드` `` · `**굵게**` · `~~취소선~~`. 그 밖의
 * 글자는 그대로 둔다. `\` 를 앞에 붙이면 표시가 아니라 글자로 읽는다.
 *
 * 코드 안에서는 다른 표시가 통하지 않는다. 닫히지 않은 표시가 남으면
 * 422 로 돌려보낸다 — 짐작해서 붙여 주면 담당자가 의도한 것과 달라진다.
 */
export function markdownToRuns(md) {
  const on = { code: false, bold: false, strikethrough: false };
  const runs = [];
  let buf = "";

  // 노션은 rich_text 한 조각을 2000자까지만 받는다. 넘으면 400 이 떨어지므로
  // 여기서 잘라 둔다. 이어 붙으면 화면에는 한 덩어리로 보인다.
  const CHUNK = 2000;

  const flush = () => {
    if (!buf) return;
    for (let at = 0; at < buf.length; at += CHUNK) {
      runs.push({
        type: "text",
        text: { content: buf.slice(at, at + CHUNK), link: null },
        annotations: { ...BLANK, ...on },
      });
    }
    buf = "";
  };

  for (let i = 0; i < md.length; ) {
    const c = md[i];

    if (c === "\\" && i + 1 < md.length) {
      buf += md[i + 1];
      i += 2;
      continue;
    }

    // 코드 안에서는 코드를 닫는 백틱만 표시로 읽는다.
    const usable = on.code ? MARKERS.filter((m) => m.key === "code") : MARKERS;
    const hit = usable.find((m) => md.startsWith(m.mark, i));
    if (hit) {
      flush();
      on[hit.key] = !on[hit.key];
      i += hit.mark.length;
      continue;
    }

    buf += c;
    i += 1;
  }
  flush();

  const open = Object.keys(on).filter((k) => on[k]);
  if (open.length) {
    throw unprocessable(`닫히지 않은 표시: ${open.join(", ")}`);
  }
  if (!runs.length) {
    throw unprocessable("빈 내용");
  }
  return runs;
}

/* ────────────────────────── rich_text → HTML ────────────────────────── */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** 빌더의 `esc()` 와 같다. 노션 텍스트는 반드시 이스케이프한다. */
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** 빌더의 `trim_runs()` 와 같다. 후행 콜론·공백을 뗀다. */
export function trimRuns(runs) {
  const out = runs.map((r) => ({ ...r }));
  while (out.length) {
    const t = (out[out.length - 1].plain_text ?? "").replace(/[\s:：]+$/u, "");
    out[out.length - 1].plain_text = t;
    if (t) break;
    out.pop();
  }
  return out;
}

/**
 * 빌더의 `runs_to_html()` 과 같은 모양. 감싸는 순서까지 같아야 한다.
 * 여기서 만드는 서식은 셋뿐이라 코드 → 취소선 → 굵게 순으로 중첩된다.
 */
export function runsToHtml(runs) {
  let out = "";
  for (const r of runs) {
    const t = r.plain_text ?? "";
    if (!t) continue;
    const a = r.annotations || {};
    let h = esc(t);
    if (a.code) h = `<code>${h}</code>`;
    if (a.underline) h = `<u>${h}</u>`;
    if (a.italic) h = `<i>${h}</i>`;
    if (a.strikethrough) h = `<s>${h}</s>`;
    if (a.bold) h = `<b>${h}</b>`;
    out += h;
  }
  return out;
}

/**
 * 저장한 블록을 화면에 그릴 HTML. 인용은 빌더와 같이 blockquote 로 감싼다.
 * 노션이 돌려준 블록을 그대로 받으므로 타입을 따로 넘겨받지 않는다.
 */
export function blockToHtml(block) {
  const html = runsToHtml(trimRuns(blockRuns(block)));
  return block?.type === "quote" && html ? `<blockquote>${html}</blockquote>` : html;
}

/**
 * 노션이 돌려준 블록이 지금 고칠 수 있는 것인지 본다.
 *
 * 화면은 잠긴 항목에 주소를 갖고 있지 않으므로 보통은 여기 걸리지 않는다.
 * 걸린다면 빌드 뒤에 노션에서 그 줄에 링크나 이모지가 붙은 것이다.
 */
export function assertEditable(block) {
  const reason = lockReason(block);
  if (reason) throw locked(reason);
}
