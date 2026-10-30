import { NextResponse, type NextRequest } from "next/server";

// Fast, optimistic redirect for signed-out visitors. The real session check
// happens on the server in the (app) layout and in every API route.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname === "/signup") return NextResponse.next();
  if (!req.cookies.has("lp_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|sw.js|manifest.webmanifest|icons|icon.png|offline|favicon.ico|robots.txt).*)"],
};
