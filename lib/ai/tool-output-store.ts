import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@/lib/logger";

const storeLog = logger.child({ module: "ToolOutputStore" });

// Full outputs live beside the Bash tool's transcripts in the OS temp dir, not
// under data/ — they are recoverable scratch, not user data worth backing up.
// Own subdirectory so the sweep only ever touches files this module wrote.
const STORE_DIR = join(tmpdir(), "agent-chat-lab-tool-output");
const FILE_PREFIX = "tool-";

/** How long a spilled output stays readable before the sweep reclaims it. */
export const TOOL_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum gap between sweeps.
 *
 * There is no always-on scheduler in a Next.js server, so the sweep piggybacks
 * on writes and self-throttles. A run that spills nothing also creates no
 * garbage, so nothing accumulates while the sweep is idle.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let lastSweepAt = 0;

/**
 * Delete spilled outputs past the retention window.
 *
 * Best-effort throughout: a file that vanished under us, or a directory we
 * cannot read, is not worth surfacing to the caller.
 */
export async function sweepExpiredToolOutputs(): Promise<void> {
  let entries: string[];

  try {
    entries = await readdir(STORE_DIR);
  } catch {
    // Nothing written yet, or the temp dir went away; either way, nothing to do.
    return;
  }

  const cutoff = Date.now() - TOOL_OUTPUT_RETENTION_MS;
  let removed = 0;

  for (const entry of entries) {
    if (!entry.startsWith(FILE_PREFIX)) {
      continue;
    }

    const file = join(STORE_DIR, entry);

    try {
      const info = await stat(file);
      if (info.mtimeMs < cutoff) {
        await unlink(file);
        removed += 1;
      }
    } catch {
      // Raced with another sweep or an external cleaner.
    }
  }

  if (removed > 0) {
    storeLog.info({ removed, dir: STORE_DIR }, "swept expired tool outputs");
  }
}

function sweepIfDue(): void {
  const now = Date.now();

  if (now - lastSweepAt < SWEEP_INTERVAL_MS) {
    return;
  }

  lastSweepAt = now;
  void sweepExpiredToolOutputs().catch(() => {});
}

/**
 * Spill one oversized tool output to disk and return its path.
 *
 * Returns undefined when persisting fails: a successful tool call must not turn
 * into a failure because we could not keep a copy of its output. The caller
 * still returns the bounded result, just without a path to the full text.
 */
export async function persistToolOutput(
  toolName: string,
  content: string,
): Promise<string | undefined> {
  const file = join(STORE_DIR, `${FILE_PREFIX}${toolName}-${randomUUID()}.json`);

  try {
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(file, content, "utf8");
    sweepIfDue();
    return file;
  } catch (error) {
    storeLog.warn(
      {
        file,
        tool: toolName,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to persist full tool output",
    );
    return undefined;
  }
}
