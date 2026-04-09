import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

function log(request: NextRequest, status: number, start: number) {
  const ms = Date.now() - start;
  const method = request.method;
  const path = request.nextUrl.pathname;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "-";
  console.log(`${new Date().toISOString()} ${method} ${path} ${status} ${ms}ms [${ip}]`);
}

function isAuthenticated(request: NextRequest): boolean {
  const password = process.env.AUTH_PASSWORD;
  if (!password) return true;
  const token = request.cookies.get("auth_token")?.value;
  const expected = createHash("sha256").update(password).digest("hex");
  return token === expected;
}

export function proxy(request: NextRequest) {
  const start = Date.now();
  const pathname = request.nextUrl.pathname;

  // Skip auth check for /api/auth and /login
  if (pathname === "/api/auth" || pathname === "/login") {
    const response = NextResponse.next();
    log(request, 200, start);
    return response;
  }

  if (!isAuthenticated(request)) {
    if (pathname.startsWith("/api/")) {
      // API routes: return 401
      log(request, 401, start);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Page routes: rewrite to /login so no real content is SSR'd
    log(request, 302, start);
    return NextResponse.rewrite(new URL("/login", request.url));
  }

  const response = NextResponse.next();
  log(request, 200, start);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
