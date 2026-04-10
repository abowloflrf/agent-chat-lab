import { type NextRequest } from "next/server";
import { renderAppIcon } from "@/lib/icon-renderer";

const ALLOWED_SIZES = [192, 512];

export function GET(request: NextRequest) {
  const sizeParam = request.nextUrl.searchParams.get("size");
  const size = sizeParam ? parseInt(sizeParam, 10) : 192;

  if (!ALLOWED_SIZES.includes(size)) {
    return new Response("Invalid size", { status: 400 });
  }

  return renderAppIcon(size);
}
