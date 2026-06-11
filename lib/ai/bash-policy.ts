export const BASH_TOOL_TIMEOUT_MS = 15_000;
export const BASH_TOOL_OUTPUT_LIMIT = 16 * 1024;
export const BASH_TOOL_MAX_COMMAND_LENGTH = 1600;
export const BASH_TOOL_WORKDIR_LABEL = "服务端运行时工作目录";

export type BashRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * auto：低风险只读命令，直接执行无需审批。
 * approval：可能修改文件或系统状态，需用户人工批准。
 * deny：确定高危或执行架构不支持，直接拒绝，批准也不会执行。
 */
export type BashDecision = "auto" | "approval" | "deny";

export type BashAssessment = {
  normalizedCommand: string;
  riskLevel: BashRiskLevel;
  decision: BashDecision;
  reasons: string[];
  workdir: string;
  timeoutMs: number;
  outputLimit: number;
  argv: string[];
  usesShell: boolean;
};

const CONTROL_CHARACTER_PATTERN = /[\r\n\t\0]/;

// 确定高危：即使用户批准也不执行。
const BLOCKED_COMMANDS = new Map<string, string>([
  ["rm", "禁止执行删除文件命令。"],
  ["shred", "禁止执行文件擦除命令。"],
  ["sudo", "禁止请求提权执行命令。"],
  ["su", "禁止切换用户。"],
  ["dd", "禁止执行底层磁盘写入命令。"],
  ["mkfs", "禁止执行文件系统格式化命令。"],
  ["mount", "禁止挂载文件系统。"],
  ["umount", "禁止卸载文件系统。"],
  ["shutdown", "禁止执行关机命令。"],
  ["reboot", "禁止执行重启命令。"],
  ["poweroff", "禁止执行电源控制命令。"],
  ["halt", "禁止执行电源控制命令。"],
  ["init", "禁止切换系统运行级别。"],
  ["diskutil", "禁止执行磁盘管理命令。"],
  ["fdisk", "禁止执行磁盘分区命令。"],
  ["parted", "禁止执行磁盘分区命令。"],
]);

// 高风险：需用户人工批准后才执行。
const HIGH_RISK_COMMANDS = new Map<string, string>([
  ["chmod", "修改文件权限属于高风险操作。"],
  ["chown", "修改文件归属属于高风险操作。"],
  ["kill", "结束进程属于高风险操作。"],
  ["pkill", "结束进程属于高风险操作。"],
  ["killall", "结束进程属于高风险操作。"],
  ["systemctl", "修改系统服务状态属于高风险操作。"],
  ["service", "修改系统服务状态属于高风险操作。"],
  ["launchctl", "修改系统服务状态属于高风险操作。"],
  ["bash", "再启动 shell 可执行任意内嵌命令，绕过策略检查。"],
  ["sh", "再启动 shell 可执行任意内嵌命令，绕过策略检查。"],
  ["zsh", "再启动 shell 可执行任意内嵌命令，绕过策略检查。"],
  ["fish", "再启动 shell 可执行任意内嵌命令，绕过策略检查。"],
  ["env", "env 可注入环境后执行任意命令，绕过策略检查。"],
  ["python", "解释器可执行任意脚本逻辑。"],
  ["python3", "解释器可执行任意脚本逻辑。"],
  ["node", "解释器可执行任意脚本逻辑。"],
  ["ruby", "解释器可执行任意脚本逻辑。"],
  ["perl", "解释器可执行任意脚本逻辑。"],
  ["php", "解释器可执行任意脚本逻辑。"],
]);

// 低风险只读命令：自动执行无需审批。
const READONLY_COMMANDS = new Set([
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "which",
  "date",
  "uname",
  "stat",
  "echo",
  "du",
  "df",
  "ps",
  "whoami",
  "hostname",
  "id",
  "file",
  "tree",
  "sort",
  "uniq",
  "cut",
  "diff",
  "basename",
  "dirname",
  "realpath",
]);

const GIT_READONLY_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "blame",
  "shortlog",
  "describe",
  "rev-parse",
  "ls-files",
]);

// find 带这些参数时会删除文件、执行命令或写文件，不能自动放行。
const FIND_MUTATING_FLAGS = ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fls"];

function collapseWhitespace(command: string) {
  return command.trim().replace(/\s+/g, " ");
}

/** 需要 shell 解释执行的特性：管道、重定向、命令替换、命令链、后台执行、通配符等。 */
function hasShellFeatures(command: string): boolean {
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
      char === ">" ||
      char === "<" ||
      char === ";" ||
      char === "&" ||
      char === "`"
    ) {
      return true;
    }

    if (char === "$" && next === "(") {
      return true;
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
      return true;
    }
  }

  return false;
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

function findGitDenyReason(argv: string[]) {
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

  return null;
}

function isAutoApprovedCommand(argv: string[]) {
  const executable = argv[0]?.toLowerCase() ?? "";

  if (executable === "git") {
    const subCommand = argv[1]?.toLowerCase() ?? "";
    return GIT_READONLY_SUBCOMMANDS.has(subCommand);
  }

  if (executable === "find") {
    return !argv.some((arg) =>
      FIND_MUTATING_FLAGS.some((flag) => arg.toLowerCase().startsWith(flag)),
    );
  }

  return READONLY_COMMANDS.has(executable);
}

function buildBaseAssessment(command: string): Omit<BashAssessment, "argv" | "usesShell"> {
  return {
    normalizedCommand: collapseWhitespace(command),
    riskLevel: "critical",
    decision: "deny",
    reasons: [],
    workdir: BASH_TOOL_WORKDIR_LABEL,
    timeoutMs: BASH_TOOL_TIMEOUT_MS,
    outputLimit: BASH_TOOL_OUTPUT_LIMIT,
  };
}

function buildDeniedAssessment(command: string, reason: string): BashAssessment {
  return {
    ...buildBaseAssessment(command),
    reasons: [reason],
    argv: [],
    usesShell: false,
  };
}

export function assessBashCommand(command: string): BashAssessment {
  const normalizedCommand = collapseWhitespace(command);

  if (!normalizedCommand) {
    return buildDeniedAssessment(command, "命令不能为空。");
  }

  if (normalizedCommand.length > BASH_TOOL_MAX_COMMAND_LENGTH) {
    return buildDeniedAssessment(command, "命令过长，已超过长度限制。");
  }

  if (CONTROL_CHARACTER_PATTERN.test(command)) {
    return buildDeniedAssessment(command, "不支持换行、制表符或其他控制字符。");
  }

  const usesShell = hasShellFeatures(command);

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
      ...buildBaseAssessment(command),
      reasons: [blockedReason],
      argv,
      usesShell: false,
    };
  }

  const gitDenyReason = findGitDenyReason(argv);
  if (gitDenyReason) {
    return {
      ...buildBaseAssessment(command),
      reasons: [gitDenyReason],
      argv,
      usesShell: false,
    };
  }

  const executionConstraints = [
    "命令将以非交互模式执行。",
    `执行目录固定为${BASH_TOOL_WORKDIR_LABEL}。`,
    "输出与执行时长都会受到限制。",
  ];

  const highRiskReason = HIGH_RISK_COMMANDS.get(executable);
  if (highRiskReason) {
    return {
      ...buildBaseAssessment(command),
      riskLevel: "high",
      decision: "approval",
      reasons: [highRiskReason, ...executionConstraints],
      argv,
      usesShell,
    };
  }

  if (usesShell) {
    return {
      ...buildBaseAssessment(command),
      riskLevel: "medium",
      decision: "approval",
      reasons: ["命令包含管道、重定向、命令替换或通配符等 shell 特性，需用户批准后执行。", ...executionConstraints],
      argv,
      usesShell: true,
    };
  }

  if (isAutoApprovedCommand(argv)) {
    return {
      ...buildBaseAssessment(command),
      riskLevel: "low",
      decision: "auto",
      reasons: ["已识别为低风险只读命令，自动执行无需审批。", ...executionConstraints],
      argv,
      usesShell: false,
    };
  }

  return {
    ...buildBaseAssessment(command),
    riskLevel: "medium",
    decision: "approval",
    reasons: ["命令可能修改文件或系统状态，需用户批准后执行。", ...executionConstraints],
    argv,
    usesShell: false,
  };
}
