/**
 * Who may open the Artifact Studio, and where everyone else is sent.
 * The request gate and the Studio pages both call this. Tests call it directly.
 */

export type StudioActor = "signed-out" | "parent" | "child" | "staff";

export type StudioDecision = { type: "allow" } | { type: "redirect"; to: string } | { type: "not-found" };

export function studioActor(input: { user: boolean; child: boolean; staff: boolean }): StudioActor {
  if (!input.user) return "signed-out";
  if (input.child) return "child";
  if (input.staff) return "staff";
  return "parent";
}

/** A child login is `account: "child"` in app metadata. A missing child id still counts. */
export function isChildLogin(user: { app_metadata?: unknown } | null | undefined): boolean {
  const meta = user?.app_metadata as { account?: string } | undefined;
  return meta?.account === "child";
}

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function studioGate(actor: StudioActor, path: string): StudioDecision {
  const studio = under(path, "/studio");
  if (actor === "signed-out") {
    if (studio) return { type: "redirect", to: `/login?next=${encodeURIComponent(path)}` };
    return { type: "allow" };
  }
  if (actor === "parent" || actor === "child") {
    if (studio) return { type: "not-found" };
    return { type: "allow" };
  }
  if (studio) return { type: "allow" };
  if (path === "/" || path === "/login" || under(path, "/parent") || under(path, "/learn")) {
    return { type: "redirect", to: "/studio" };
  }
  return { type: "allow" };
}
