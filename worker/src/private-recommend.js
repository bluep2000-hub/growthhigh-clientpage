import { ApiError } from "./error.js";

const CATALOG_URL = "https://curation.growthhigh.co.kr/data-full.json";
const REVIEW_BASE = "https://curation.growthhigh.co.kr/";

export async function selectedPrograms(env, slug) {
  const row = await env.PRIVATE_DB.prepare(`SELECT json_group_array(json_object(
    'slug', program_slug, 'added_at', added_at, 'pinned', pinned)) AS items FROM (
      SELECT program_slug, added_at, pinned FROM recommendation_items
      WHERE customer_slug = ? ORDER BY pinned DESC, created_at, program_slug
    )`).bind(slug).first();
  return JSON.parse(row?.items || "[]");
}

function deadlineInfo(value) {
  const raw = String(value || "");
  const date = /^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(raw) ? raw.slice(0, 10) : "";
  const dateStart = Date.parse(`${date}T00:00:00Z`);
  if (!date || !Number.isFinite(dateStart)
      || new Date(dateStart).toISOString().slice(0, 10) !== date)
    return { deadline: null, deadline_at: null };
  const at = raw.length === 10 ? `${date}T23:59:59+09:00` : raw;
  return Number.isFinite(Date.parse(at))
    ? { deadline: date, deadline_at: at }
    : { deadline: null, deadline_at: null };
}

const expired = program => !!program.deadline_at && Date.parse(program.deadline_at) < Date.now();

export async function policyCatalog(fetcher = fetch) {
  let response;
  try { response = await fetcher(CATALOG_URL, { signal: AbortSignal.timeout(12000) }); }
  catch { throw new ApiError(503, "catalog_unavailable"); }
  if (!response.ok) throw new ApiError(503, "catalog_unavailable");
  let programs;
  try { programs = (await response.json()).programs; }
  catch { throw new ApiError(503, "catalog_unavailable"); }
  if (!Array.isArray(programs)) throw new ApiError(503, "catalog_unavailable");
  return programs.filter(p => p && typeof p.file === "string"
    && /^[^/?#\\]+\.html$/.test(p.file)).map(p => {
      const deadline = deadlineInfo(p.deadline_iso);
      const program = {
        slug: p.file.slice(0, -5), title: String(p.title || ""),
        industries: Array.isArray(p.industries) ? p.industries.filter(x => typeof x === "string") : [],
        summary: String(p.summary || ""), audience: String(p.meta?.["대상"] || ""),
        amount: String(p.meta?.["지원"] || p.meta?.["상금"] || ""),
        deadline_note: String(p.meta?.["마감"] || p.deadline_display || ""),
        ...deadline, review_url: REVIEW_BASE + encodeURIComponent(p.file),
      };
      return { ...program, expired: expired(program) };
    });
}

const todayKst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysLeft = (deadline, today) => (Date.parse(deadline + "T00:00:00Z")
  - Date.parse(today + "T00:00:00Z")) / 86400000;

export function customerRecommendations(selected, catalog, today = todayKst()) {
  const bySlug = new Map(catalog.map(program => [program.slug, program]));
  return selected.map(item => ({ program: bySlug.get(item.slug), pinned: !!item.pinned }))
    .filter(item => item.program).map(({ program, pinned }) => {
    const left = program.deadline ? daysLeft(program.deadline, today) : null;
    return { ...program, pinned, org: null, dday: left === null ? "" : left === 0 ? "D-DAY"
      : left > 0 ? `D-${left}` : `D+${-left}`, expired: left !== null && left < 0 };
  }).filter(program => !expired(program)).sort((a, b) =>
    Number(b.pinned) - Number(a.pinned)
    || (a.deadline || "9999-12-31").localeCompare(b.deadline || "9999-12-31"));
}

export async function changeRecommendation(env, slug, programSlug, method, catalog) {
  if (typeof programSlug !== "string" || !programSlug || programSlug.length > 180)
    throw new ApiError(422, "invalid_program");
  if (method === "PUT") {
    const program = catalog.find(p => p.slug === programSlug);
    if (!program || expired(program))
      throw new ApiError(422, "invalid_program");
    await env.PRIVATE_DB.prepare(`INSERT INTO recommendation_items
      (customer_slug, program_slug, added_at, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(customer_slug, program_slug) DO NOTHING`)
      .bind(slug, programSlug, todayKst(), Date.now()).run();
  } else if (method === "DELETE") {
    await env.PRIVATE_DB.prepare(`DELETE FROM recommendation_items
      WHERE customer_slug = ? AND program_slug = ?`).bind(slug, programSlug).run();
  }
  return selectedPrograms(env, slug);
}

export async function setRecommendationPin(env, slug, programSlug, pinned) {
  if (typeof programSlug !== "string" || !programSlug || programSlug.length > 180
      || typeof pinned !== "boolean") throw new ApiError(422, "invalid_program");
  if (!(await selectedPrograms(env, slug)).some(item => item.slug === programSlug))
    throw new ApiError(404, "not_found");
  await env.PRIVATE_DB.prepare(`UPDATE recommendation_items SET pinned = ?
    WHERE customer_slug = ? AND program_slug = ?`).bind(pinned ? 1 : 0, slug, programSlug).run();
  return selectedPrograms(env, slug);
}
