import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { MAX_FILE_COUNT, MAX_FILE_KB, unpack } from "./unpack";

function makeZip(entries: Record<string, Uint8Array | string>): Uint8Array {
  const prepared: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(entries)) prepared[k] = typeof v === "string" ? strToU8(v) : v;
  return zipSync(prepared);
}

describe("unpack html input", () => {
  it("returns a single index.html", () => {
    const r = unpack({ kind: "html", source: "<!doctype html><html></html>" });
    expect(r.errors).toEqual([]);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]!.path).toBe("index.html");
    expect(r.files[0]!.mime).toBe("text/html");
  });
});

describe("unpack zip input", () => {
  it("extracts allowlisted files with the right mime", () => {
    const r = unpack({
      kind: "zip",
      bytes: makeZip({
        "index.html": "<!doctype html><html></html>",
        "js/main.js": "var a=1;",
        "styles.css": "body{}",
      }),
    });
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => f.path).sort()).toEqual(["index.html", "js/main.js", "styles.css"]);
    expect(r.files.find((f) => f.path === "js/main.js")!.mime).toBe("application/javascript");
  });

  it("rejects zip-slip paths", () => {
    const r = unpack({ kind: "zip", bytes: makeZip({ "../evil.html": "<html></html>" }) });
    expect(r.files).toEqual([]);
    expect(r.errors[0]?.code).toBe("unsafe-path");
  });

  it("rejects absolute paths", () => {
    const r = unpack({ kind: "zip", bytes: makeZip({ "/root.html": "<html></html>" }) });
    expect(r.errors[0]?.code).toBe("unsafe-path");
  });

  it("rejects files with disallowed extensions", () => {
    const r = unpack({ kind: "zip", bytes: makeZip({ "index.html": "<html></html>", "evil.exe": "x" }) });
    expect(r.files.map((f) => f.path)).toEqual(["index.html"]);
    expect(r.errors[0]?.code).toBe("bad-mime");
  });

  it("rejects a single file over the per-file cap", () => {
    const big = new Uint8Array(MAX_FILE_KB * 1024 + 1);
    big[0] = 0x89;
    big[1] = 0x50;
    big[2] = 0x4e;
    big[3] = 0x47;
    const r = unpack({ kind: "zip", bytes: makeZip({ "big.png": big }) });
    expect(r.files).toEqual([]);
    expect(r.errors[0]?.code).toBe("file-too-big");
  });

  it("rejects bundles over the total cap", () => {
    const entries: Record<string, Uint8Array> = {};
    const chunkSize = MAX_FILE_KB * 1024; // 5 MB each → 4 chunks exceeds 15 MB
    for (let i = 0; i < 4; i++) {
      const b = new Uint8Array(chunkSize);
      b[0] = 0x89;
      b[1] = 0x50;
      b[2] = 0x4e;
      b[3] = 0x47;
      entries[`img${i}.png`] = b;
    }
    const r = unpack({ kind: "zip", bytes: makeZip(entries) });
    expect(r.errors.some((e) => e.code === "bundle-too-big")).toBe(true);
  });

  it("rejects bundles with too many files", () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i <= MAX_FILE_COUNT; i++) entries[`js/${i}.js`] = "var x=1;";
    const r = unpack({ kind: "zip", bytes: makeZip(entries) });
    expect(r.errors[0]?.code).toBe("too-many-files");
  });

  it("reports malformed zips", () => {
    const r = unpack({ kind: "zip", bytes: new Uint8Array([1, 2, 3, 4]) });
    expect(r.errors[0]?.code).toBe("zip-malformed");
  });
});

describe("unpack files input", () => {
  it("rejects duplicate paths", () => {
    const bytes = new TextEncoder().encode("<html></html>");
    const r = unpack({
      kind: "files",
      files: [
        { path: "index.html", bytes, mime: "text/html" },
        { path: "index.html", bytes, mime: "text/html" },
      ],
    });
    expect(r.errors[0]?.code).toBe("duplicate-path");
  });
});
