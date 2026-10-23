import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const root = process.argv[2] ?? new URL("./samples", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const sample of readdirSync(root)) {
  const files = walk(join(root, sample));
  const found = { scriptSrc: new Set(), importMap: new Set(), imports: new Set(), linkHref: new Set(), cssImport: new Set(), otherUrls: new Set(), apis: new Set() };
  let bytes = 0;
  for (const f of files) {
    const s = readFileSync(f, "utf8"); bytes += s.length;
    for (const m of s.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) found.scriptSrc.add(m[1]);
    for (const m of s.matchAll(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)) { try { for (const [k, v] of Object.entries(JSON.parse(m[1]).imports ?? {})) found.importMap.add(`${k} -> ${v}`); } catch { found.importMap.add("UNPARSEABLE"); } }
    for (const m of s.matchAll(/\bimport\s*(?:[\w*{}\s,]+from\s*)?["']([^"']+)["']/g)) found.imports.add(m[1]);
    for (const m of s.matchAll(/\bimport\(\s*["']([^"']+)["']/g)) found.imports.add("dynamic:" + m[1]);
    for (const m of s.matchAll(/<link[^>]*\bhref=["']([^"']+)["']/g)) found.linkHref.add(m[1]);
    for (const m of s.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/g)) found.cssImport.add(m[1]);
    for (const m of s.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) found.otherUrls.add(m[0].replace(/[,;]$/, ""));
    for (const [re, name] of [[/\bfetch\s*\(/, "fetch"], [/XMLHttpRequest/, "XHR"], [/WebSocket/, "WebSocket"], [/localStorage|sessionStorage/, "web storage"], [/indexedDB/, "indexedDB"], [/window\.(parent|top)\b/, "parent/top"], [/\.requestFullscreen/, "fullscreen"], [/AudioContext/, "WebAudio"], [/navigator\.vibrate/, "vibrate"], [/new Worker|SharedArrayBuffer/, "worker"], [/\balert\(|\bconfirm\(|\bprompt\(/, "modal dialogs"], [/requestAnimationFrame/, "rAF"], [/prefers-reduced-motion/, "reduced-motion"], [/document\.cookie/, "cookie"], [/eval\(|new Function/, "eval"]]) if (re.test(s)) found.apis.add(name);
  }
  const known = [...found.scriptSrc, ...found.linkHref, ...found.cssImport];
  for (const u of known) found.otherUrls.delete(u);
  console.log(`\n## ${sample}  (${files.length} files, ${Math.round(bytes / 1024)} KB): ${files.map((f) => relative(join(root, sample), f)).join(", ")}`);
  for (const [k, v] of Object.entries(found)) if (v.size) console.log(`  ${k}: ${[...v].join(" | ")}`);
}
