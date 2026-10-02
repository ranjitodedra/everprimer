/**
 * Set while a shared device is handed to a child. While present, the
 * grown-up area requires the parent PIN (see /unlock).
 */
export const KID_MODE_COOKIE = "eco_active_child";

export const KID_MODE_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 } as const;
