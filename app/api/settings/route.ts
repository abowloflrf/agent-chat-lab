import { getSystemSettings, saveSystemSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  const settings = await getSystemSettings();
  return Response.json({ settings });
}

export async function PUT(request: Request) {
  try {
    const json = await request.json();
    const settings = await saveSystemSettings(json);
    return Response.json({ settings });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to save settings.",
      },
      { status: 400 },
    );
  }
}
