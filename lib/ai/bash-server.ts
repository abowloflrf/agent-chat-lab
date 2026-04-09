import "server-only";

import { spawn } from "node:child_process";
import {
  assessBashCommand,
  type BashAssessment,
} from "@/lib/ai/bash-policy";

type LimitedOutput = {
  text: string;
  truncated: boolean;
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
};

function truncateOutput(value: string, limit: number): LimitedOutput {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
    };
  }

  return {
    text: `${value.slice(0, limit)}\n…[输出已截断]`,
    truncated: true,
  };
}

export async function executeBashCommand(command: string): Promise<BashExecutionResult> {
  const assessment = assessBashCommand(command);

  if (assessment.decision === "deny") {
    throw new Error(assessment.reasons.join(" "));
  }

  const startedAt = Date.now();

  return new Promise<BashExecutionResult>((resolve, reject) => {
    const child = spawn(assessment.argv[0], assessment.argv.slice(1), {
      cwd: assessment.workdir,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
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
      if (stdoutTruncated) {
        return;
      }

      const next = truncateOutput(stdout + chunk, assessment.outputLimit);
      stdout = next.text;
      stdoutTruncated = next.truncated;
    });

    child.stderr.on("data", (chunk: string) => {
      if (stderrTruncated) {
        return;
      }

      const next = truncateOutput(stderr + chunk, assessment.outputLimit);
      stderr = next.text;
      stderrTruncated = next.truncated;
    });

    child.on("error", (error) => {
      finalize(() => reject(error));
    });

    child.on("close", (exitCode) => {
      finalize(() => {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const stderrWithTimeout = timedOut
          ? `${stderr}${stderr ? "\n" : ""}命令执行超时，已被终止。`
          : stderr;

        resolve({
          command: assessment.normalizedCommand,
          exitCode,
          stdout,
          stderr: stderrWithTimeout,
          durationMs,
          riskLevel: assessment.riskLevel,
          reasons: assessment.reasons,
          workdir: assessment.workdir,
        });
      });
    });
  });
}
