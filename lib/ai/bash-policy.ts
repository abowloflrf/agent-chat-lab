export const BASH_TOOL_TIMEOUT_MS = 15_000;
export const BASH_TOOL_OUTPUT_LIMIT = 16 * 1024;
export const BASH_TOOL_MAX_COMMAND_LENGTH = 400;
export const BASH_TOOL_WORKDIR_LABEL = "服务端运行时工作目录";

export type BashRiskLevel = "low" | "medium" | "high" | "critical";
export type BashDecision = "allow" | "deny";

export type BashAssessment = {
  normalizedCommand: string;
  riskLevel: BashRiskLevel;
  decision: BashDecision;
  reasons: string[];
  workdir: string;
  timeoutMs: number;
  outputLimit: number;
  argv: string[];
};

const CONTROL_CHARACTER_PATTERN = /[\r\n\t\0]/;

const BLOCKED_COMMANDS = new Map<string, string>([
  ["rm", "禁止执行删除文件命令。"],
  ["sudo", "禁止请求提权执行命令。"],
  ["su", "禁止切换用户。"],
  ["chmod", "禁止修改文件权限。"],
  ["chown", "禁止修改文件归属。"],
  ["dd", "禁止执行底层磁盘写入命令。"],
  ["mkfs", "禁止执行文件系统格式化命令。"],
  ["mount", "禁止挂载文件系统。"],
  ["umount", "禁止卸载文件系统。"],
  ["shutdown", "禁止执行关机命令。"],
  ["reboot", "禁止执行重启命令。"],
  ["poweroff", "禁止执行电源控制命令。"],
  ["kill", "禁止结束进程。"],
  ["pkill", "禁止结束进程。"],
  ["killall", "禁止结束进程。"],
  ["init", "禁止切换系统运行级别。"],
  ["systemctl", "禁止修改系统服务状态。"],
  ["service", "禁止修改系统服务状态。"],
  ["launchctl", "禁止修改系统服务状态。"],
  ["diskutil", "禁止执行磁盘管理命令。"],
  ["fdisk", "禁止执行磁盘分区命令。"],
  ["parted", "禁止执行磁盘分区命令。"],
  ["bash", "禁止再启动 shell 解释器。"],
  ["sh", "禁止再启动 shell 解释器。"],
  ["zsh", "禁止再启动 shell 解释器。"],
  ["fish", "禁止再启动 shell 解释器。"],
  ["env", "禁止通过 env 注入环境后再执行命令。"],
  ["python", "第一版禁止执行解释器脚本。"],
  ["python3", "第一版禁止执行解释器脚本。"],
  ["node", "第一版禁止执行解释器脚本。"],
  ["ruby", "第一版禁止执行解释器脚本。"],
  ["perl", "第一版禁止执行解释器脚本。"],
  ["php", "第一版禁止执行解释器脚本。"],
  ["npm", "第一版禁止执行可能修改依赖树的包管理命令。"],
  ["pnpm", "第一版禁止执行可能修改依赖树的包管理命令。"],
  ["yarn", "第一版禁止执行可能修改依赖树的包管理命令。"],
  ["bun", "第一版禁止执行可能修改依赖树的包管理命令。"],
]);

function collapseWhitespace(command: string) {
  return command.trim().replace(/\s+/g, " ");
}

function findForbiddenSyntax(command: string) {
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }

      if (char === "\\") {
        index += 1;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (
      char === "|" ||
      char === ";" ||
      char === ">" ||
      char === "<" ||
      char === "&" ||
      char === "`"
    ) {
      return "第一版不支持管道、重定向、命令替换或后台执行等复杂 shell 特性。";
    }

    if (char === "$" && next === "(") {
      return "第一版不支持命令替换。";
    }

    if (
      char === "*" ||
      char === "?" ||
      char === "[" ||
      char === "]" ||
      char === "{" ||
      char === "}" ||
      char === "~"
    ) {
      return "第一版不支持通配符或大括号扩展。";
    }
  }

  return null;
}

export function tokenizeBashCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }

      if (char === "\\") {
        const next = command[index + 1];
        if (!next) {
          throw new Error("命令中的转义序列不完整。");
        }
        current += next;
        index += 1;
        continue;
      }

      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      const next = command[index + 1];
      if (!next) {
        throw new Error("命令中的转义序列不完整。");
      }
      current += next;
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("命令中的引号未闭合。");
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function assessGitCommand(argv: string[]) {
  if (argv[0] !== "git") {
    return null;
  }

  const subCommand = argv[1];
  if (!subCommand) {
    return null;
  }

  if (subCommand === "reset" && argv.includes("--hard")) {
    return "禁止执行 git reset --hard。";
  }

  if (subCommand === "clean" && argv.some((arg) => /^-.*f/.test(arg))) {
    return "禁止执行 git clean 强制清理。";
  }

  if (subCommand === "checkout" && argv.some((arg) => arg === "--" || arg.startsWith("--"))) {
    return "第一版禁止执行可能覆写工作区的 git checkout。";
  }

  return null;
}

function buildDeniedAssessment(command: string, reason: string): BashAssessment {
  return {
    normalizedCommand: collapseWhitespace(command),
    riskLevel: "critical",
    decision: "deny",
    reasons: [reason],
    workdir: BASH_TOOL_WORKDIR_LABEL,
    timeoutMs: BASH_TOOL_TIMEOUT_MS,
    outputLimit: BASH_TOOL_OUTPUT_LIMIT,
    argv: [],
  };
}

export function assessBashCommand(command: string): BashAssessment {
  const normalizedCommand = collapseWhitespace(command);

  if (!normalizedCommand) {
    return buildDeniedAssessment(command, "命令不能为空。");
  }

  if (normalizedCommand.length > BASH_TOOL_MAX_COMMAND_LENGTH) {
    return buildDeniedAssessment(command, "命令过长，已超过第一版限制。");
  }

  if (CONTROL_CHARACTER_PATTERN.test(command)) {
    return buildDeniedAssessment(command, "第一版不支持换行、制表符或其他控制字符。");
  }

  const forbiddenSyntaxReason = findForbiddenSyntax(command);
  if (forbiddenSyntaxReason) {
    return buildDeniedAssessment(command, forbiddenSyntaxReason);
  }

  let argv: string[];
  try {
    argv = tokenizeBashCommand(normalizedCommand);
  } catch (error) {
    return buildDeniedAssessment(
      command,
      error instanceof Error ? error.message : "命令解析失败。",
    );
  }

  if (argv.length === 0) {
    return buildDeniedAssessment(command, "未解析出可执行命令。");
  }

  const executable = argv[0]?.toLowerCase() ?? "";
  const blockedReason = BLOCKED_COMMANDS.get(executable);
  if (blockedReason) {
    return {
      normalizedCommand,
      riskLevel: "critical",
      decision: "deny",
      reasons: [blockedReason],
      workdir: BASH_TOOL_WORKDIR_LABEL,
      timeoutMs: BASH_TOOL_TIMEOUT_MS,
      outputLimit: BASH_TOOL_OUTPUT_LIMIT,
      argv,
    };
  }

  const gitReason = assessGitCommand(argv);
  if (gitReason) {
    return {
      normalizedCommand,
      riskLevel: "critical",
      decision: "deny",
      reasons: [gitReason],
      workdir: BASH_TOOL_WORKDIR_LABEL,
      timeoutMs: BASH_TOOL_TIMEOUT_MS,
      outputLimit: BASH_TOOL_OUTPUT_LIMIT,
      argv,
    };
  }

  const reasons = [
    "命令将以非交互模式执行。",
    `执行目录固定为${BASH_TOOL_WORKDIR_LABEL}。`,
    "输出与执行时长都会受到限制。",
  ];

  const readOnlyCommands = new Set([
    "pwd",
    "ls",
    "cat",
    "sed",
    "head",
    "tail",
    "wc",
    "find",
    "rg",
    "git",
    "which",
    "date",
    "uname",
    "stat",
  ]);

  const riskLevel: BashRiskLevel = readOnlyCommands.has(executable) ? "low" : "medium";

  return {
    normalizedCommand,
    riskLevel,
    decision: "allow",
    reasons,
    workdir: BASH_TOOL_WORKDIR_LABEL,
    timeoutMs: BASH_TOOL_TIMEOUT_MS,
    outputLimit: BASH_TOOL_OUTPUT_LIMIT,
    argv,
  };
}
