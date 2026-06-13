import { discoverSkills } from "@/lib/ai/skills";

export const runtime = "nodejs";

// 列出服务器 skill 目录中检测到的 skill（name + description），供设置页展示与开关。
// 受 proxy 的鉴权层自动保护，与其它非公开 API 一致。
export async function GET() {
  const skills = await discoverSkills();
  return Response.json({ skills });
}
