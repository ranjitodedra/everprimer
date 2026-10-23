import { describe, expect, it } from "vitest";
import { VENDOR_LOCK, cdnjsPath, findVendorPackage, hasVendoredFile, isAllowedPin, versionsOf } from "./lock";

describe("VENDOR_LOCK", () => {
  it("is a v1 lock with the ADR-003 allowlist", () => {
    expect(VENDOR_LOCK.lockVersion).toBe(1);
    const pins = VENDOR_LOCK.packages.map((p) => `${p.name}@${p.version}`).sort();
    expect(pins).toEqual([
      "canvas-confetti@1.9.2",
      "gsap@3.12.5",
      "matter-js@0.19.0",
      "three@0.160.0",
      "three@0.170.0",
    ]);
  });

  it("strips $comment keys from cdnjsFileMap", () => {
    expect(Object.keys(VENDOR_LOCK.cdnjsFileMap)).toEqual(["matter-js", "gsap"]);
  });
});

describe("isAllowedPin", () => {
  it("accepts allowlisted pins and rejects everything else", () => {
    expect(isAllowedPin("three@0.170.0")).toBe(true);
    expect(isAllowedPin("THREE@0.170.0")).toBe(true);
    expect(isAllowedPin("three@0.165.0")).toBe(false);
    expect(isAllowedPin("cannon-es@0.20.0")).toBe(false);
  });
});

describe("findVendorPackage / versionsOf", () => {
  it("looks up a package by exact version", () => {
    expect(findVendorPackage("three", "0.160.0")?.license).toBe("MIT");
    expect(findVendorPackage("three", "0.165.0")).toBeUndefined();
  });

  it("lists known versions newest first", () => {
    expect(versionsOf("three")).toEqual(["0.170.0", "0.160.0"]);
  });
});

describe("cdnjsPath", () => {
  it("maps cdnjs file names back to npm paths", () => {
    expect(cdnjsPath("matter-js", "matter.min.js")).toBe("build/matter.min.js");
    expect(cdnjsPath("gsap", "gsap.min.js")).toBe("dist/gsap.min.js");
    expect(cdnjsPath("gsap", "unknown.js")).toBeNull();
    expect(cdnjsPath("three", "three.min.js")).toBeNull();
  });
});

describe("hasVendoredFile", () => {
  it("accepts files declared directly and under a directory prefix", () => {
    expect(hasVendoredFile("three", "0.170.0", "build/three.module.js")).toBe(true);
    expect(hasVendoredFile("three", "0.170.0", "examples/jsm/controls/OrbitControls.js")).toBe(true);
    expect(hasVendoredFile("three", "0.170.0", "src/Three.js")).toBe(false);
  });

  it("accepts minify-alias paths", () => {
    expect(hasVendoredFile("canvas-confetti", "1.9.2", "dist/confetti.browser.min.js")).toBe(true);
    expect(hasVendoredFile("canvas-confetti", "1.9.2", "dist/confetti.browser.js")).toBe(true);
  });
});
