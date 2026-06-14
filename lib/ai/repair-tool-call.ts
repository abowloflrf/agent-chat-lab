import type { ToolCallRepairFunction, ToolSet } from "ai";

/**
 * 确定性工具调用修复。
 *
 * 被 Claude Code 语料调过的模型常会“按习惯”调用大写名（Read/Write/Edit）并
 * 使用 file_path / old_string 等参数键，与本地工具的真实契约不符，于是第一次
 * 调用报错、模型再退回正确名重试，白白浪费一个 step。
 *
 * 本修复器在 SDK 抛 NoSuchToolError / InvalidToolInputError 时被调用，纯本地
 * 把工具名与参数键改写成本地 schema 后返回修正版（不再请求模型，零额外往返）。
 * 无法安全修复时返回 null，把原始错误还回去。
 */

// 归一化工具名：忽略大小写与下划线/连字符/空格，吸收 Read↔read、web_search↔WebSearch 这类差异。
const norm = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, "");

// 真·同义词（不同词根，norm 无法覆盖）→ 本地工具名。只保留高置信、无歧义的映射。
const ALIASES: Record<string, string> = {
  view: "read",
  cat: "read",
  strreplace: "edit",
  strreplaceeditor: "edit",
  strreplacebasededittool: "edit",
  replace: "edit",
};

// 把模型给的工具名解析成本地真实存在的工具名；无法对应时返回 null。
function resolveToolName(name: string, available: string[]): string | null {
  if (available.includes(name)) return name; // 已合法（多半是参数问题，仍需走参数改写）
  const normalized = norm(name);
  const ci = available.find((tool) => norm(tool) === normalized);
  if (ci) return ci;
  const alias = ALIASES[normalized];
  return alias && available.includes(alias) ? alias : null;
}

// 把 Claude Code 参数约定改写成本地 schema；返回是否真的改动过。
function remapArgs(tool: string, args: Record<string, unknown>): boolean {
  let changed = false;

  // Read/Write/Edit 用 file_path，本地用 path。
  if (
    (tool === "read" || tool === "write" || tool === "edit") &&
    "file_path" in args &&
    !("path" in args)
  ) {
    args.path = args.file_path;
    delete args.file_path;
    changed = true;
  }

  // Edit 用 old_string/new_string(/replace_all)，本地用 edits:[{oldText,newText}]。
  if (tool === "edit" && "old_string" in args && !("edits" in args)) {
    args.edits = [
      {
        oldText: args.old_string,
        newText: "new_string" in args ? args.new_string : "",
      },
    ];
    delete args.old_string;
    delete args.new_string;
    delete args.replace_all; // 本地 edit 以唯一匹配为准，不支持 replace_all
    changed = true;
  }

  return changed;
}

export const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({
  toolCall,
  tools,
}) => {
  const canonical = resolveToolName(toolCall.toolName, Object.keys(tools));
  if (!canonical) return null; // 没有对应的本地工具，交还原始错误

  let parsed: unknown;
  try {
    parsed = toolCall.input?.trim() ? JSON.parse(toolCall.input) : {};
  } catch {
    // 参数不是合法 JSON，无法安全改写；至少把名字纠正过来。
    return canonical !== toolCall.toolName
      ? { ...toolCall, toolName: canonical }
      : null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return canonical !== toolCall.toolName
      ? { ...toolCall, toolName: canonical }
      : null;
  }

  const args = parsed as Record<string, unknown>;
  const nameChanged = canonical !== toolCall.toolName;
  const argsChanged = remapArgs(canonical, args);
  if (!nameChanged && !argsChanged) return null; // 没什么可修

  return { ...toolCall, toolName: canonical, input: JSON.stringify(args) };
};
