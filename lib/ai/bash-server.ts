import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessBashCommand,
  type BashAssessment,
} from "@/lib/ai/bash-policy";

// Hard ceiling on how much output we keep in memory to write to the temp file.
// The tail window (assessment.outputLimit) is what the model sees; this larger
// cap is the full transcript saved for follow-up `read` calls.
const FULL_CAPTURE_MAX_CHARS = 2 * 1024 * 1024;

type OutputCapture = {
  push: (chunk: string) => void;
  result: () => {
    tail: string;
    full: string;
    truncated: boolean;
    fullCapped: boolean;
  };
};

export type BashExecutionResult = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  riskLevel: BashAssessment["riskLevel"];
  reasons: string[];
  workdir: string;
  // Set when stdout/stderr was truncated: path to the temp file holding the
  // full transcript, which the model can open with the `read` tool.
  fullOutputPath?: string;
};

// Keeps the most recent `tailLimit` chars for the model, plus the leading
// `fullCap` chars for the persisted transcript. Errors usually surface at the
// end of output, so the tail is what the model needs most.
function createOutputCapture(tailLimit: number, fullCap: number): OutputCapture {
  let tail = "";
  let full = "";
  let total = 0;
  let fullCapped = false;

  return {
    push(chunk: string) {
      total += chunk.length;

      tail += chunk;
      if (tail.length > tailLimit) {
        tail = tail.slice(tail.length - tailLimit);
      }

      if (!fullCapped) {
        if (full.length + chunk.length > fullCap) {
          full += chunk.slice(0, fullCap - full.length);
          fullCapped = true;
        } else {
          full += chunk;
        }
      }
    },
    result() {
      return {
        tail,
        full,
        truncated: total > tailLimit,
        fullCapped,
      };
    },
  };
}

function resolveBashToolWorkdir() {
  const configuredWorkdir = process.env.BASH_TOOL_WORKDIR?.trim();

  if (configuredWorkdir && existsSync(configuredWorkdir)) {
    return configuredWorkdir;
  }

  const currentWorkdir = process.cwd();
  if (existsSync(currentWorkdir)) {
    return currentWorkdir;
  }

  return "/";
}

// Re-export under the original name so the file tools keep a single source of
// truth for the working directory.
export { resolveBashToolWorkdir };

async function persistFullOutput(
  command: string,
  stdout: string,
  stderr: string,
  capped: boolean,
): Promise<string | undefined> {
  const file = join(tmpdir(), `bash-tool-${randomUUID()}.log`);
  const header = [
    `# full output of: ${command}`,
    capped
      ? `# note: transcript itself capped at ${FULL_CAPTURE_MAX_CHARS} chars`
      : null,
    "",
    "## stdout",
    stdout,
    "",
    "## stderr",
    stderr,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    await writeFile(file, header, "utf8");
    return file;
  } catch {
    // Persisting the full transcript is best-effort; a failure here must not
    // sink the command result the model is waiting on.
    return undefined;
  }
}

function toExecutionError(error: NodeJS.ErrnoException, workdir: string) {
  if (error.code === "ENOENT") {
    return new Error(
      `命令启动失败：找不到可执行文件，或工作目录不存在。command=${error.path ?? "unknown"} workdir=${workdir}`,
    );
  }

  return error;
}

export async function executeBashCommand(command: string): Promise<BashExecutionResult> {
  const assessment = assessBashCommand(command);
  const workdir = resolveBashToolWorkdir();

  if (assessment.decision === "deny") {
    throw new Error(assessment.reasons.join(" "));
  }

  const startedAt = Date.now();

  return new Promise<BashExecutionResult>((resolve, reject) => {
    // detached:true 让子进程成为新进程组的组长（pgid === child.pid），这样超时
    // 时可以用 process.kill(-pid) 杀掉整个管道（shell 及其全部子孙），而不是只杀
    // shell 本身——否则 `python3 | tail` 里的子进程会被过继给 PID 1 残留为僵尸。
    const child = assessment.usesShell
      ? spawn(command, [], {
          cwd: workdir,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
          detached: true,
        })
      : spawn(assessment.argv[0], assessment.argv.slice(1), {
          cwd: workdir,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
          detached: true,
        });

    const stdoutCapture = createOutputCapture(assessment.outputLimit, FULL_CAPTURE_MAX_CHARS);
    const stderrCapture = createOutputCapture(assessment.outputLimit, FULL_CAPTURE_MAX_CHARS);
    let settled = false;
    let timedOut = false;

    // 杀掉整个进程组（前缀负号 = pgid），覆盖管道里的所有子孙进程。
    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) {
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        // 进程组已退出（ESRCH）等，忽略即可。
      }
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 500).unref();
    }, assessment.timeoutMs);

    const finalize = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      handler();
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdoutCapture.push(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      stderrCapture.push(chunk);
    });

    child.on("error", (error) => {
      finalize(() => reject(toExecutionError(error, workdir)));
    });

    child.on("close", (exitCode) => {
      finalize(() => {
        void (async () => {
          const durationMs = Math.max(0, Date.now() - startedAt);
          const so = stdoutCapture.result();
          const se = stderrCapture.result();

          let fullOutputPath: string | undefined;
          if (so.truncated || se.truncated) {
            fullOutputPath = await persistFullOutput(
              assessment.normalizedCommand,
              so.full,
              se.full,
              so.fullCapped || se.fullCapped,
            );
          }

          const truncationNote = (truncated: boolean) =>
            truncated
              ? `…[较早的输出已截断，仅保留最新 ${assessment.outputLimit} 字符${
                  fullOutputPath ? `；完整输出见 ${fullOutputPath}，可用 read 工具查看` : ""
                }]\n`
              : "";

          const stdout = `${truncationNote(so.truncated)}${so.tail}`;
          const stderrBase = `${truncationNote(se.truncated)}${se.tail}`;
          const stderr = timedOut
            ? `${stderrBase}${stderrBase ? "\n" : ""}命令执行超时，已被终止。`
            : stderrBase;

          resolve({
            command: assessment.normalizedCommand,
            exitCode,
            stdout,
            stderr,
            durationMs,
            riskLevel: assessment.riskLevel,
            reasons: assessment.reasons,
            workdir,
            ...(fullOutputPath ? { fullOutputPath } : {}),
          });
        })();
      });
    });
  });
}
