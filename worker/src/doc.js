/**
 * 공지 문서의 모양.
 *
 * 공지 한 건이 문서 하나다. 제목·날짜·섹션 배열을 가지고, 섹션은 제목 하나와
 * 항목 배열을, 항목은 종류·글·체크·하위 항목 배열을 가진다. 저장은 이것을
 * 통째로 덮어쓴다 — 줄마다 따로 보내지 않으므로 무게 상한도, 부분 실패도
 * 없다(`docs/adr/0004-공지-원본-이사.md`).
 *
 * 여기서 두 가지를 한다.
 *
 * - **모양을 확인한다.** 하나라도 어긋나면 아무것도 쓰지 않고 거절한다.
 *   반쯤 들어간 문서를 만들지 않기 위해서다.
 * - **주소를 붙인다.** 항목과 섹션의 주소는 중계 서버가 만든 짧은 이름이다.
 *   화면이 주소 없이 보낸 줄(방금 보탠 줄)에 여기서 이름이 붙는다.
 */

import { unprocessable } from "./error.js";
import { editHtmlToRuns, runsToEditHtml } from "./richtext.js";

/**
 * 항목의 종류. 노션 블록 이름이 아니라 우리 것이다 — 원본이 우리에게 온
 * 마당에 남의 낱말을 문서에 실어 둘 까닭이 없다.
 */
const ITEM_KINDS = new Set([
  "bullet", "number", "todo", "paragraph", "quote", "toggle",
  // 줄 안의 제목. `# ` `## ` `### ` 로 만든다. 칸(섹션)이 그 공지의 큰 제목이고
  // 이것들은 그 아래다 — 노션이 페이지 제목 밑에 h1·h2·h3 를 두는 것과 같다.
  "heading1", "heading2", "heading3",
  // 코드는 서식 없는 글 한 덩어리다. 줄바꿈이 그대로 살아야 하므로 <br> 로 싣는다.
  "code",
  // 표. 칸(cell)을 한 줄로 늘어놓고 `cols` 로 몇 칸마다 줄을 바꾸는지 적는다.
  // 행을 따로 두지 않는 것은 행이 아무것도 지니지 않기 때문이다 — 두면 확인할
  // 것과 주소를 붙일 것만 한 겹 늘고, 담당자에게 보이는 것은 달라지지 않는다.
  "table", "cell",
]);

/**
 * 표 한 줄에 놓을 수 있는 칸의 수.
 *
 * 클라이언트 화면이 폭 좁은 화면에서도 읽혀야 한다. 여덟을 넘기면 어차피
 * 가로로 흘러 표의 값어치가 없어진다.
 */
const MAX_COLS = 8;

/** 주소로 받아 주는 모양. 짧은 이름이고, 화면이 지어낸 긴 값을 막는다. */
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * 문서가 파고들 수 있는 깊이.
 *
 * 들여쓰기에 제품의 제한을 두려는 것이 아니다 — 회의록이 이만큼 깊어지는
 * 일은 없다. 장난스러운 본문 하나가 재귀를 끝까지 밀어 500 을 만들지 않게
 * 막는 것뿐이다.
 */
const MAX_DEPTH = 50;

/**
 * 저장하러 온 섹션 배열을 확인하고 주소를 채워 돌려준다.
 *
 * @param {unknown} raw 화면이 보낸 `sections`
 * @returns {object[]} 저장소에 그대로 넣을 섹션 배열
 */
export function readSections(raw) {
  const taken = new Set();
  const sections = asArray(raw, "sections").map((s) => {
    if (!isObject(s)) throw unprocessable("섹션이 아닙니다");
    return {
      id: readId(s.id, taken),
      title: readTitle(s.title, "섹션 제목"),
      items: readItems(s.items, taken, 1),
    };
  });
  // 이름은 문서를 다 훑은 뒤에 붙인다. 훑는 중에 붙이면 뒤에 올 줄이 쓰고
  // 있는 이름을 앞의 빈 줄에 붙이게 된다.
  return fillIds(sections, minter(taken));
}

/** 공지 한 건의 제목. 서식 없는 글자다. 갓 만든 공지의 제목은 빈 값이다. */
export function readTitle(value, name = "title") {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw unprocessable(`${name} 이 글자가 아닙니다`);
  return value;
}

/**
 * @param {string|null} parent 이 배열을 품은 항목의 종류. 맨 위는 null 이다.
 *        표의 칸이 표 밖에 서 있는 문서를 막는 데 쓴다.
 */
function readItems(raw, taken, depth, parent = null) {
  if (raw === undefined || raw === null) return [];
  if (depth > MAX_DEPTH) throw unprocessable("항목이 너무 깊습니다");

  const rows = asArray(raw, "items").map((i) => {
    if (!isObject(i)) throw unprocessable("항목이 아닙니다");
    if (!ITEM_KINDS.has(i.type)) throw unprocessable(`모르는 종류: ${i.type}`);
    // 표의 칸은 표 안에만 선다. 밖에 두면 화면이 그릴 자리가 없어 소리 없이
    // 사라지고, 담당자는 저장했는데 없어졌다고 읽는다.
    if ((i.type === "cell") !== (parent === "table")) {
      throw unprocessable(parent === "table"
        ? "표 안에는 칸만 놓습니다" : "표의 칸이 표 밖에 있습니다");
    }

    const item = { id: readId(i.id, taken), type: i.type, html: readHtml(i.html) };
    // 체크는 할 일에만 싣는다. 다른 종류에 남겨 두면 종류를 바꿔 돌아왔을 때
    // 꺼 둔 적 없는 체크가 되살아난다.
    if (i.type === "todo") item.checked = i.checked === true;
    if (i.type === "table") item.cols = readCols(i.cols);
    item.items = readItems(i.items, taken, depth + 1, i.type);
    if (i.type === "table") readGrid(item);
    // 칸 안에는 아무것도 들이지 않는다. 표 안의 표는 화면이 그리지 못한다.
    if (i.type === "cell" && item.items.length) {
      throw unprocessable("표의 칸에는 줄을 넣지 못합니다");
    }
    return item;
  });
  return rows;
}

/** 표 한 줄에 놓을 칸의 수. */
function readCols(cols) {
  if (!Number.isInteger(cols) || cols < 1 || cols > MAX_COLS) {
    throw unprocessable(`표의 칸 수가 잘못되었습니다: ${cols}`);
  }
  return cols;
}

/**
 * 표가 네모인지 본다.
 *
 * 칸 수가 `cols` 의 배수가 아니면 마지막 줄이 모자란 표다. 화면은 그것을
 * 그리다 줄이 깨지고, 다음 저장은 그 깨진 모양을 그대로 되돌려 보낸다 —
 * 한 번 어긋나면 스스로 낫지 않으므로 들어올 때 막는다.
 */
function readGrid(table) {
  const n = table.items.length;
  if (!n) throw unprocessable("표에 칸이 없습니다");
  if (n % table.cols) throw unprocessable("표의 줄이 고르지 않습니다");
}

/**
 * 화면이 댄 주소.
 *
 * 없으면 빈 자리로 두었다가 나중에 이름을 붙인다. 같은 주소가 둘이면 다음
 * 저장이 어느 줄을 짚는지 알 수 없으므로 여기서 거절한다.
 */
function readId(id, taken) {
  if (id === undefined || id === null) return undefined;
  if (typeof id !== "string" || !ID.test(id)) throw unprocessable(`받을 수 없는 주소: ${id}`);
  if (taken.has(id)) throw unprocessable(`같은 주소가 둘입니다: ${id}`);
  taken.add(id);
  return id;
}

/**
 * 항목의 글.
 *
 * 아는 태그만 남긴다. 클라이언트 페이지는 이 글을 그대로 그리므로, 여기를
 * 지나지 않은 HTML 이 들어가면 비밀번호 안쪽 화면에 남의 스크립트가 실린다.
 * 확인과 다듬기를 한 번에 하려고 `rich_text` 를 거쳐 되돌린다 — 태그 문법은
 * 편집용 HTML 한 벌뿐이고, 그것이 `richtext.js` 에 있다. 노션에만 있던
 * 불투명 조각(`data-o`)은 짚을 원본이 없어 그 길에서 함께 거절된다.
 *
 * **빈 글도 받는다.** 담당자가 Enter 로 방금 만든 줄이 그것이다. 여기서
 * 거절하면 빈 줄 하나 때문에 저장 전체가 막힌다. 빈 항목은 빌더가 버린다.
 */
function readHtml(html) {
  if (html === undefined || html === null) return "";
  if (typeof html !== "string") throw unprocessable("html 이 글자가 아닙니다");
  if (!html.trim()) return "";
  return runsToEditHtml(editHtmlToRuns(html));
}

/** 주소가 비어 있는 줄에 이름을 붙인다. 다 훑은 뒤라 겹칠 일이 없다. */
function fillIds(nodes, mint) {
  for (const node of nodes) {
    if (node.id === undefined) node.id = mint();
    fillIds(node.items, mint);
  }
  return nodes;
}

/** 이미 쓰이는 이름은 건너뛴다. */
function minter(taken) {
  let next = 1;
  return () => {
    let made;
    do {
      made = `n${next}`;
      next += 1;
    } while (taken.has(made));
    taken.add(made);
    return made;
  };
}

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function asArray(v, name) {
  if (!Array.isArray(v)) throw unprocessable(`${name} 가 배열이 아닙니다`);
  return v;
}
