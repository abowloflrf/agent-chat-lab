import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";

// Skills 来源是一个固定目录：每个子目录一个 skill，目录名即 skill 名，
// 目录内必须有一个 SKILL.md（Markdown + 极简 YAML frontmatter）。默认放在
// workspace/skills 下——与 SQLite 数据一样属于用户运行时数据（挂载 volume、不进
// git 与镜像，完全由用户管理）；可用 SKILLS_DIR 环境变量覆盖位置。
const SKILLS_DIR =
  process.env.SKILLS_DIR?.trim() ||
  path.join(process.cwd(), "workspace", "skills");
const SKILL_FILE_NAME = "SKILL.md";

// 目录名 = skill 名，同时作为 loadSkill 的入参。约束为小写字母数字加连字符，
// 既符合 SKILL.md 开放标准的命名习惯，也天然排除 "." 与 "/"，杜绝路径穿越。
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

export type SkillInfo = {
  name: string;
  description: string;
};

export type LoadedSkill = {
  name: string;
  /** SKILL.md 全文，调用 Skill 工具时才返回给模型（渐进式披露）。 */
  content: string;
  /** skill 目录内除 SKILL.md 外的附属文件绝对路径，供模型按需用 cat 读取。 */
  files: string[];
};

export function getSkillsDir(): string {
  return SKILLS_DIR;
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name);
}

/**
 * 极简 frontmatter 解析：只取首个 `---`…`---` 块内的 name / description 单行值，
 * 不引入完整 YAML 解析器。未知字段忽略，与 Codex / opencode 的实际实现一致。
 */
function parseSkillFrontmatter(raw: string): {
  name?: string;
  description?: string;
} {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(raw);

  if (!match) {
    return {};
  }

  const result: { name?: string; description?: string } = {};

  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.*)$/.exec(line.trim());

    if (!kv) {
      continue;
    }

    let value = kv[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (kv[1] === "name") {
      result.name = value;
    } else {
      result.description = value;
    }
  }

  return result;
}

/** resolve 后断言路径仍落在 skills 根目录内，防御 frontmatter / 入参里的越界路径。 */
function isInsideSkillsDir(targetPath: string): boolean {
  const resolvedRoot = path.resolve(SKILLS_DIR);
  const resolved = path.resolve(targetPath);

  return (
    resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
  );
}

/**
 * 扫描 skills 根目录，返回每个有效 skill 的 name + description。
 *
 * 这是渐进式披露的第一层：只读取 frontmatter 元数据，不返回正文。无效项
 * （缺 SKILL.md、命名非法、无 description）跳过并告警，整体不抛——某个坏
 * skill 不应阻断对话。每次调用都重新读盘，因此在服务器放好文件即时可见。
 */
export async function discoverSkills(): Promise<SkillInfo[]> {
  let entries;

  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    // 目录不存在表示尚未安装任何 skill，是正常状态，不必告警。
    if (code !== "ENOENT") {
      logger.warn(
        {
          skillsDir: SKILLS_DIR,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to read skills directory; skipping skills",
      );
    }

    return [];
  }

  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const name = entry.name;

    if (!SKILL_NAME_PATTERN.test(name)) {
      logger.warn({ skill: name }, "Skill directory name invalid; skipping");
      continue;
    }

    if (seen.has(name)) {
      continue;
    }

    let raw: string;

    try {
      raw = await readFile(path.join(SKILLS_DIR, name, SKILL_FILE_NAME), "utf8");
    } catch {
      // 没有 SKILL.md 的普通目录，静默跳过。
      continue;
    }

    const { description } = parseSkillFrontmatter(raw);

    if (!description) {
      logger.warn(
        { skill: name },
        "Skill missing frontmatter description; skipping",
      );
      continue;
    }

    seen.add(name);
    skills.push({
      name,
      description: description.slice(0, MAX_SKILL_DESCRIPTION_LENGTH),
    });
  }

  // 稳定排序，让每轮注入系统提示的 skill 清单顺序一致，利于前缀缓存命中。
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 返回 skills 根目录中当前存在的 skill 子目录名集合，供保存设置时清理 disabled
 * 名单里的死数据。
 *
 * 只看子目录是否存在（不深究 SKILL.md / frontmatter），因为能进入 disabled 名单
 * 的名字此前必然是有效 skill，按目录存在性即可准确区分“被删”与“还在”，也不会因
 * frontmatter 临时不规范而误判。
 *
 * 关键区别于返回空集：目录读取成功（即使为空）返回集合；目录不存在或读取失败返回
 * null，表示“无法确认存在性”，调用方据此跳过清理，避免目录临时不可见（如部署中
 * volume 尚未就绪）时误删用户的禁用选择。
 */
export async function getExistingSkillNames(): Promise<Set<string> | null> {
  let entries;

  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  return new Set(
    entries
      .filter(
        (entry) => entry.isDirectory() && SKILL_NAME_PATTERN.test(entry.name),
      )
      .map((entry) => entry.name),
  );
}

/**
 * 加载单个 skill 的完整内容（渐进式披露的第二层）。
 *
 * 仅在模型调用 Skill 工具时触发。name 必须通过命名校验且解析后仍在 skills 根
 * 目录内；任何非法 / 不存在的 name 返回 null，由调用方转成对模型的错误说明。
 */
export async function loadSkill(name: string): Promise<LoadedSkill | null> {
  const trimmed = name.trim();

  if (!SKILL_NAME_PATTERN.test(trimmed)) {
    return null;
  }

  const skillDir = path.join(SKILLS_DIR, trimmed);

  if (!isInsideSkillsDir(skillDir)) {
    return null;
  }

  let content: string;

  try {
    content = await readFile(path.join(skillDir, SKILL_FILE_NAME), "utf8");
  } catch {
    return null;
  }

  let files: string[] = [];

  try {
    const entries = await readdir(skillDir, { withFileTypes: true });
    files = entries
      .filter((entry) => entry.name !== SKILL_FILE_NAME)
      .map((entry) =>
        entry.isDirectory()
          ? `${path.join(skillDir, entry.name)}/`
          : path.join(skillDir, entry.name),
      )
      .sort();
  } catch {
    files = [];
  }

  return { name: trimmed, content, files };
}
