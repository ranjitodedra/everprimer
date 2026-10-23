import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isArtifactHost, isArtifactRoutePath } from "@/lib/artifact-host";
import { KID_MODE_COOKIE } from "@/lib/kid-mode";

const PROTECTED_PREFIXES = ["/parent", "/learn", "/unlock"];

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Refreshes the Supabase session cookie on every request, gates the parent
 * and child surfaces behind sign-in, keeps child logins inside their own
 * learn pages, and puts the grown-up area behind the PIN while a shared
 * device is in kid mode.
 *
 * Host-based routing (ADR-001): the artifact origin is a disjoint hostname that
 * answers only on `/a/*` and never touches Supabase cookies. On the app host,
 * requests to `/a/*` 404 so a stray request there cannot borrow app cookies to
 * fetch artifact bytes.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const onArtifactHost = isArtifactHost(request);
  const onArtifactPath = isArtifactRoutePath(path);

  if (onArtifactHost) {
    if (!onArtifactPath) return new NextResponse(null, { status: 404 });
    return NextResponse.next({ request });
  }
  if (onArtifactPath) {
    return new NextResponse(null, { status: 404 });
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectTo = (pathname: string, search = "") => {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    target.search = search;
    const res = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!user) {
    if (PROTECTED_PREFIXES.some((p) => under(path, p))) return redirectTo("/login", `?next=${encodeURIComponent(path)}`);
    return response;
  }

  const meta = user.app_metadata as { account?: string; child_id?: string } | undefined;
  if (meta?.account === "child") {
    const home = `/learn/${meta.child_id}`;
    return meta.child_id && under(path, home) ? response : redirectTo(home);
  }

  if (path === "/login") return redirectTo("/");
  if (request.cookies.has(KID_MODE_COOKIE) && under(path, "/parent")) {
    return redirectTo("/unlock", `?next=${encodeURIComponent(path)}`);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
