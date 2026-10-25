import { describe, expect, it } from "vitest";
import { isChildLogin, studioActor, studioGate } from "./studio";

describe("studioActor", () => {
  it("treats a missing user as signed out, and a child login as a child even if staff is also set", () => {
    expect(studioActor({ user: false, child: false, staff: false })).toBe("signed-out");
    expect(studioActor({ user: true, child: true, staff: true })).toBe("child");
    expect(studioActor({ user: true, child: false, staff: true })).toBe("staff");
    expect(studioActor({ user: true, child: false, staff: false })).toBe("parent");
  });

  it("treats a child login as a child even when the child id is missing", () => {
    expect(isChildLogin({ app_metadata: { account: "child" } })).toBe(true);
    expect(isChildLogin({ app_metadata: { account: "parent" } })).toBe(false);
    expect(isChildLogin(null)).toBe(false);
  });
});

describe("studioGate", () => {
  it("sends a signed-out person who opens the Artifact Studio to sign-in", () => {
    expect(studioGate("signed-out", "/studio")).toEqual({ type: "redirect", to: "/login?next=%2Fstudio" });
  });

  it("gives a parent or a child a 404 for the Artifact Studio", () => {
    expect(studioGate("parent", "/studio")).toEqual({ type: "not-found" });
    expect(studioGate("child", "/studio/staff")).toEqual({ type: "not-found" });
  });

  it("lets staff open the Artifact Studio", () => {
    expect(studioGate("staff", "/studio")).toEqual({ type: "allow" });
    expect(studioGate("staff", "/studio/new")).toEqual({ type: "allow" });
  });

  it("sends staff from the parent area, a learner page, sign-in, and the home page back to the Artifact Studio", () => {
    expect(studioGate("staff", "/parent")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/parent/settings")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/learn/child-1")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/login")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/")).toEqual({ type: "redirect", to: "/studio" });
  });

  it("leaves a parent on the parent area", () => {
    expect(studioGate("parent", "/parent")).toEqual({ type: "allow" });
    expect(studioGate("signed-out", "/")).toEqual({ type: "allow" });
  });
});
