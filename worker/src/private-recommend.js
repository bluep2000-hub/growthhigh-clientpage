import { ApiError } from "./error.js";

const CATALOG_URL = "https://bluep2000-hub.github.io/growthhigh-policy/data-full.json";
const REVIEW_BASE = "https://bluep2000-hub.github.io/growthhigh-policy/";

export async function selectedPrograms(env, slug) {
  const row = await env.PRIVATE_DB.prepare(`SELECT json_group_array(json_object(
    'slug', program_slug, 'added_at', added_at)) AS items FROM (
      SELECT program_slug, added_at FROM recommendation_items
      WHERE customer_slug = ? ORDER BY created_at, program_slug
    )`).bind(slug).first();
  return JSON.parse(row?.items || "[]");
}

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
    && /^[^/?#\\]+\.html$/.test(p.file)).map(p => ({
      slug: p.file.slice(0, -5), title: String(p.title || ""),
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(p.deadline_iso || "")
        && !Number.isNaN(Date.parse(p.deadline_iso + "T00:00:00Z")) ? p.deadline_iso : null,
      amount: p.meta?.["지원"] || null, review_url: REVIEW_BASE + encodeURIComponent(p.file),
    }));
}

const todayKst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysLeft = (deadline, today) => (Date.parse(deadline + "T00:00:00Z")
  - Date.parse(today + "T00:00:00Z")) / 86400000;

export function customerRecommendations(selected, catalog, today = todayKst()) {
  const bySlug = new Map(catalog.map(program => [program.slug, program]));
  return selected.map(item => bySlug.get(item.slug)).filter(Boolean).map(program => {
    const left = program.deadline ? daysLeft(program.deadline, today) : null;
    return { ...program, org: null, dday: left === null ? "" : left === 0 ? "D-DAY"
      : left > 0 ? `D-${left}` : `D+${-left}`, expired: left !== null && left < 0 };
  }).filter(program => !program.expired).sort((a, b) =>
    (a.deadline || "9999-12-31").localeCompare(b.deadline || "9999-12-31"));
}

export async function changeRecommendation(env, slug, programSlug, method, catalog) {
  if (typeof programSlug !== "string" || !programSlug || programSlug.length > 180)
    throw new ApiError(422, "invalid_program");
  if (method === "PUT") {
    const program = catalog.find(p => p.slug === programSlug);
    if (!program || (program.deadline && daysLeft(program.deadline, todayKst()) < 0))
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
