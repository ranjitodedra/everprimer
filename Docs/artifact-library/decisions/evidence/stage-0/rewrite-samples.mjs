import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
// Usage: node rewrite-samples.mjs <dest-dir>   (the spike serves <worktree>/apps/web/spike-assets/samples)
const SRC = new URL("./samples", import.meta.url).pathname;
const DEST = process.argv[2] ?? "../startup-eco-spike/apps/web/spike-assets/samples";
const VENDOR = "/spike-artifact/absent/corsx/vendor";
const ALLOW = new Set(["three@0.160.0", "three@0.170.0", "matter-js@0.19.0", "gsap@3.12.5", "canvas-confetti@1.9.2"]);
// cdnjs does not mirror npm layout, so each library needs its own file map.
const CDNJS = { "matter-js": { "matter.min.js": "build/matter.min.js", "matter.js": "build/matter.js" }, gsap: { "gsap.min.js": "dist/gsap.min.js" } };
const report = [];
function rewrite(text, file) {
  let out = text;
  out = out.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/([a-z0-9@._\/-]+?)@(\d+\.\d+\.\d+)\/([^"'\s)]*)/gi, (m, pkg, ver, path) => {
    const key = `${pkg}@${ver}`;
    if (!ALLOW.has(key)) { report.push(`${file}: REJECT ${key} (not on allowlist)`); return m; }
    report.push(`${file}: jsdelivr ${key}/${path}`);
    return `${VENDOR}/${key}/${path}`;
  });
  out = out.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/([a-z0-9._-]+)\/(\d+\.\d+\.\d+)\/([^"'\s)]+)/gi, (m, pkg, ver, path) => {
    const key = `${pkg}@${ver}`;
    const mapped = CDNJS[pkg]?.[path];
    if (!ALLOW.has(key) || !mapped) { report.push(`${file}: REJECT cdnjs ${key}/${path}`); return m; }
    report.push(`${file}: cdnjs ${key}/${path} -> ${mapped}`);
    return `${VENDOR}/${key}/${mapped}`;
  });
  const before = out.length;
  out = out.replace(/<link[^>]+href=["']https:\/\/fonts\.(googleapis|gstatic)\.com[^>]*>\s*/gi, "");
  if (out.length !== before) report.push(`${file}: stripped Google Fonts links`);
  return out;
}
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const s of readdirSync(SRC)) {
  mkdirSync(join(DEST, s), { recursive: true });
  for (const f of walk(join(SRC, s))) {
    const rel = f.slice(join(SRC, s).length + 1);
    mkdirSync(join(DEST, s, rel, ".."), { recursive: true });
    writeFileSync(join(DEST, s, rel), /\.(html|js|css|mjs)$/.test(f) ? rewrite(readFileSync(f, "utf8"), `${s}/${rel}`) : readFileSync(f));
  }
}
console.log(report.join("\n"));
