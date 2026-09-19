import { access, copyFile, cp, mkdir, readdir, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const out = new URL("../pages-dist/", import.meta.url);
const exists = (url) => access(url).then(() => true, () => false);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of ["index.html", "favicon.ico", "robots.txt", ".nojekyll"])
  await copyFile(new URL(file, root), new URL(file, out));
for (const folder of ["_verify", "assets", "logo"]) {
  const source = new URL(`${folder}/`, root);
  if (await exists(source)) await cp(source, new URL(`${folder}/`, out), { recursive: true });
}

await mkdir(new URL("c/", out));
for (const entry of await readdir(new URL("c/", root), { withFileTypes: true })) {
  if (entry.isFile() && entry.name !== "whiffkorea.enc")
    await copyFile(new URL(`c/${entry.name}`, root), new URL(`c/${entry.name}`, out));
}

const reserved = new Set([
  ".claude", ".github", ".impeccable", "_verify", "assets", "c", "docs", "functions",
  "logo", "node_modules", "pages", "pages-dist", "scripts", "skills", "src", "worker",
  "whiffkorea",
]);
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || reserved.has(entry.name)) continue;
  const client = new URL(`${entry.name}/`, root);
  if (await exists(new URL("index.html", client)))
    await cp(client, new URL(`${entry.name}/`, out), { recursive: true });
}

await copyFile(new URL("pages/404.html", root), new URL("404.html", out));
await copyFile(new URL("pages/_routes.json", root), new URL("_routes.json", out));
