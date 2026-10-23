import { describe, expect, it } from "vitest";
import { mimeFromExtension, resolveFileMime, sniffMime } from "./mime";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0]);
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0, 0]);
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0]);
const MP3_ID3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0]);
const MP3_RAW = new Uint8Array([0xff, 0xfb, 0, 0]);

describe("mimeFromExtension", () => {
  it("maps allowlisted extensions, is case-insensitive, rejects others", () => {
    expect(mimeFromExtension("foo/bar.PNG")).toBe("image/png");
    expect(mimeFromExtension("x.mjs")).toBe("application/javascript");
    expect(mimeFromExtension("x.exe")).toBeNull();
    expect(mimeFromExtension("noext")).toBeNull();
  });
});

describe("sniffMime", () => {
  it("detects common binary formats and MP3 variants", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(WOFF2)).toBe("font/woff2");
    expect(sniffMime(GLB)).toBe("model/gltf-binary");
    expect(sniffMime(OGG)).toBe("audio/ogg");
    expect(sniffMime(MP3_ID3)).toBe("audio/mpeg");
    expect(sniffMime(MP3_RAW)).toBe("audio/mpeg");
    expect(sniffMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("resolveFileMime", () => {
  it("accepts text formats that look like text", () => {
    expect(resolveFileMime("x.html", new TextEncoder().encode("<!doctype html>")).ok).toBe(true);
    expect(resolveFileMime("x.svg", new TextEncoder().encode("<svg></svg>")).ok).toBe(true);
    expect(resolveFileMime("x.js", new TextEncoder().encode("var x = 1;")).ok).toBe(true);
  });

  it("rejects a renamed binary posing as text", () => {
    const r = resolveFileMime("x.js", PNG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/contains binary bytes/);
  });

  it("rejects binary files whose bytes don't match the extension", () => {
    const r = resolveFileMime("fake.png", JPEG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/claims image\/png but its bytes look like image\/jpeg/);
  });

  it("rejects unknown extensions", () => {
    const r = resolveFileMime("x.exe", new Uint8Array([0x4d, 0x5a]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not on the allowlist/);
  });

  it("accepts opaque .bin blobs without sniffing", () => {
    expect(resolveFileMime("gltf-buffer.bin", new Uint8Array([0, 0, 0, 0])).ok).toBe(true);
  });
});
