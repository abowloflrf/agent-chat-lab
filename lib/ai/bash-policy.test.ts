import { describe, it, expect } from "vitest";
import {
  assessBashCommand,
  tokenizeBashCommand,
  BASH_TOOL_MAX_COMMAND_LENGTH,
  BASH_TOOL_WORKDIR_LABEL,
} from "@/lib/ai/bash-policy";

describe("tokenizeBashCommand", () => {
  it("splits on whitespace", () => {
    expect(tokenizeBashCommand("ls -la /tmp")).toEqual(["ls", "-la", "/tmp"]);
  });

  it("collapses repeated whitespace between tokens", () => {
    expect(tokenizeBashCommand("  ls    -la  ")).toEqual(["ls", "-la"]);
  });

  it("keeps single-quoted content as one token and strips the quotes", () => {
    expect(tokenizeBashCommand("echo 'hello world'")).toEqual([
      "echo",
      "hello world",
    ]);
  });

  it("does not interpret escapes inside single quotes", () => {
    expect(tokenizeBashCommand("echo 'a\\nb'")).toEqual(["echo", "a\\nb"]);
  });

  it("processes escapes inside double quotes", () => {
    expect(tokenizeBashCommand('echo "a\\"b"')).toEqual(["echo", 'a"b']);
  });

  it("handles backslash escaping outside quotes", () => {
    expect(tokenizeBashCommand("echo a\\ b")).toEqual(["echo", "a b"]);
  });

  it("throws on an unclosed quote", () => {
    expect(() => tokenizeBashCommand("echo 'unterminated")).toThrow(
      /引号未闭合/,
    );
  });

  it("throws on a trailing incomplete escape", () => {
    expect(() => tokenizeBashCommand("echo a\\")).toThrow(/转义序列不完整/);
  });
});

describe("assessBashCommand — invalid input", () => {
  it("denies an empty command", () => {
    const result = assessBashCommand("   ");
    expect(result.decision).toBe("deny");
    expect(result.riskLevel).toBe("critical");
    expect(result.reasons).toContain("命令不能为空。");
  });

  it("denies a command that exceeds the length limit", () => {
    const command = `echo ${"a".repeat(BASH_TOOL_MAX_COMMAND_LENGTH)}`;
    const result = assessBashCommand(command);
    expect(result.decision).toBe("deny");
    expect(result.reasons[0]).toMatch(/命令过长/);
  });

  it("denies a command that fails to tokenize (unclosed quote)", () => {
    const result = assessBashCommand("echo 'oops");
    expect(result.decision).toBe("deny");
    expect(result.reasons[0]).toMatch(/引号未闭合/);
  });
});

describe("assessBashCommand — blocked (deny) commands", () => {
  it.each([
    ["rm -rf /tmp/x", "rm"],
    ["shred secret", "shred"],
    ["sudo apt update", "sudo"],
    ["su root", "su"],
    ["dd if=/dev/zero of=/dev/sda", "dd"],
    ["mkfs /dev/sda1", "mkfs"],
    ["mount /dev/sda1 /mnt", "mount"],
    ["shutdown now", "shutdown"],
    ["reboot", "reboot"],
  ])("denies %s outright", (command) => {
    const result = assessBashCommand(command);
    expect(result.decision).toBe("deny");
    expect(result.riskLevel).toBe("critical");
  });

  it("is case-insensitive on the executable name", () => {
    expect(assessBashCommand("RM -rf x").decision).toBe("deny");
  });

  // KNOWN GAP: the deny-list keys on the exact executable name, so dotted
  // variants like `mkfs.ext4` / `mkfs.vfat` are NOT hard-denied — they only
  // fall through to "approval". This test pins the current (leaky) behavior;
  // if the policy is tightened to prefix/family matching, update it.
  it("does NOT hard-deny dotted mkfs variants (current behavior)", () => {
    expect(assessBashCommand("mkfs.ext4 /dev/sda1").decision).toBe("approval");
  });
});

describe("assessBashCommand — git denylist", () => {
  it("denies git reset --hard", () => {
    expect(assessBashCommand("git reset --hard HEAD").decision).toBe("deny");
  });

  it("allows git reset without --hard (still mutating → approval)", () => {
    const result = assessBashCommand("git reset HEAD~1");
    expect(result.decision).toBe("approval");
  });

  it("denies git clean with a force flag", () => {
    expect(assessBashCommand("git clean -fd").decision).toBe("deny");
    expect(assessBashCommand("git clean -f").decision).toBe("deny");
  });

  it("auto-approves git status (read-only subcommand)", () => {
    const result = assessBashCommand("git status");
    expect(result.decision).toBe("auto");
    expect(result.riskLevel).toBe("low");
  });

  it("auto-approves git log and git diff", () => {
    expect(assessBashCommand("git log --oneline").decision).toBe("auto");
    expect(assessBashCommand("git diff").decision).toBe("auto");
  });

  it("requires approval for a non-read-only git subcommand", () => {
    expect(assessBashCommand("git commit -m x").decision).toBe("approval");
  });
});

describe("assessBashCommand — high-risk (approval) commands", () => {
  it.each([
    "chmod 777 file",
    "chown root file",
    "kill 123",
    "pkill node",
    "systemctl restart nginx",
    "bash script.sh",
    "sh -c 'echo hi'",
    "env FOO=bar cmd",
    "python script.py",
    "python3 script.py",
    "node app.js",
  ])("flags %s as high-risk approval", (command) => {
    const result = assessBashCommand(command);
    expect(result.decision).toBe("approval");
    expect(result.riskLevel).toBe("high");
  });
});

describe("assessBashCommand — shell features", () => {
  it.each([
    "cat a | grep b",
    "echo hi > out.txt",
    "cat < in.txt",
    "ls; pwd",
    "ls && pwd",
    "echo `whoami`",
    "echo $(whoami)",
    "ls *.ts",
    "cat file?.txt",
    "ls ~/docs",
  ])("flags %s as medium-risk approval requiring shell", (command) => {
    const result = assessBashCommand(command);
    expect(result.decision).toBe("approval");
    expect(result.riskLevel).toBe("medium");
    expect(result.usesShell).toBe(true);
  });

  it("does not treat shell metacharacters inside quotes as shell features", () => {
    // echo is read-only and the pipe is quoted → no shell features → auto.
    const result = assessBashCommand("echo 'a|b'");
    expect(result.usesShell).toBe(false);
    expect(result.decision).toBe("auto");
  });

  it("blocked command wins over shell features (rm | x still denied)", () => {
    const result = assessBashCommand("rm x | tee log");
    expect(result.decision).toBe("deny");
  });
});

describe("assessBashCommand — read-only auto commands", () => {
  it.each(["pwd", "ls -la", "cat file.txt", "grep foo bar.txt", "wc -l x"])(
    "auto-approves %s",
    (command) => {
      const result = assessBashCommand(command);
      expect(result.decision).toBe("auto");
      expect(result.riskLevel).toBe("low");
      expect(result.usesShell).toBe(false);
    },
  );

  it("auto-approves find without mutating flags", () => {
    expect(assessBashCommand("find . -name '*.ts'").decision).toBe("auto");
  });

  it.each(["find . -delete", "find . -exec rm {} ;", "find . -okdir cmd"])(
    "requires approval for mutating find: %s",
    (command) => {
      // Note: these may also trip shell-feature detection ({}, ;), but the key
      // assertion is that they are never auto-approved.
      expect(assessBashCommand(command).decision).toBe("approval");
    },
  );
});

describe("assessBashCommand — unknown commands default to approval", () => {
  it("treats an unrecognised command as medium-risk approval", () => {
    const result = assessBashCommand("npm install");
    expect(result.decision).toBe("approval");
    expect(result.riskLevel).toBe("medium");
    expect(result.usesShell).toBe(false);
  });
});

describe("assessBashCommand — assessment shape", () => {
  it("returns the normalized command, argv, and fixed workdir label", () => {
    const result = assessBashCommand("  ls    -la  ");
    expect(result.normalizedCommand).toBe("ls -la");
    expect(result.argv).toEqual(["ls", "-la"]);
    expect(result.workdir).toBe(BASH_TOOL_WORKDIR_LABEL);
  });

  it("preserves multi-line content inside quotes in argv", () => {
    const result = assessBashCommand('python -c "import os\nprint(1)"');
    // normalizedCommand collapses whitespace, but argv keeps the newline.
    expect(result.argv[2]).toContain("\n");
  });
});
