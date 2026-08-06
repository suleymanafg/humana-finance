// Route guard (Next 16 "proxy" convention, replaces middleware).
// Pages and CRUD APIs require a session; /login, auth APIs and the token-based
// 1C import endpoint are open (the 1C route checks its own API key).
// /f/<token> and /api/f/<token> are the public data-request fill page: the
// token is the credential and it is scoped to a single request, which the
// service layer verifies on every call.
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth-crypto";
import { canAccessPath } from "@/lib/permissions";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const open =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/import/1c") ||
    pathname.startsWith("/f/") ||
    pathname.startsWith("/api/f/") ||
    pathname.startsWith("/api/telegram/");
  // the root layout needs the path to decide whether to render the app shell
  const withPath = () => {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  };
  if (open) return withPath();

  const session = verifySessionToken(request.cookies.get("hf-session")?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // admin-only sections: staff and viewers are bounced to the dashboard rather
  // than shown a page they cannot use
  if (!canAccessPath(session.role, pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return withPath();
}

export const config = {
  matcher: ["/((?!_next|favicon\\.ico|.*\\.svg$).*)"],
};
