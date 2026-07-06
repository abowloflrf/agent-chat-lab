import { createHash } from "crypto";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const authLog = logger.child({ module: "Auth" });

// Best-effort client IP for audit logs (behind the homelab reverse proxy).
function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getExpectedToken(): string {
  const password = process.env.AUTH_PASSWORD;
  if (!password) throw new Error("AUTH_PASSWORD environment variable is not set");
  return createHash("sha256").update(password).digest("hex");
}

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("auth_token="))
    ?.split("=")[1];

  const authenticated = token === getExpectedToken();
  return Response.json({ authenticated });
}

export async function POST(request: Request) {
  const { password } = await request.json();
  const expected = process.env.AUTH_PASSWORD;
  const ip = clientIp(request);

  if (!expected) {
    authLog.error("AUTH_PASSWORD not configured; login rejected");
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  if (password !== expected) {
    authLog.warn({ ip }, "failed login attempt");
    return Response.json({ error: "密码错误" }, { status: 401 });
  }

  authLog.info({ ip }, "login succeeded");
  const token = getExpectedToken();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
    },
  });
}
