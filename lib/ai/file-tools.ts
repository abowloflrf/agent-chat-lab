import "server-only";

import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { resolveBashToolWorkdir } from "@/lib/ai/bash-server";

// read 的截断上限：行数/字节任一触顶即截断，模型可用 offset 继续读直到读完。
// 字节上限与 TOOL_OUTPUT_MAX_BYTES 对齐——否则统一的工具输出预算会在这之后再砍
// 一刀，让这里的上限和工具描述都名不副实。
export const FILE_READ_MAX_LINES = 2000;
export const FILE_READ_MAX_BYTES = 32 * 1024;
// write 单次写入上限，避免模型一次性灌入超大内容。
export const FILE_WRITE_MAX_BYTES = 1024 * 1024;

export type ReadFileInput = {
  path: string;
  offset?: number;
  limit?: number;
};

export type WriteFileInput = {
  path: string;
  content: string;
};

export type EditFileInput = {
  path: string;
  edits: { oldText: string; newText: string }[];
};

/** 相对路径基于 Bash 工具的工作目录解析，绝对路径原样保留。 */
function resolveToWorkdir(inputPath: string): string {
  if (isAbsolute(inputPath)) {
    return inputPath;
  }

  return resolvePath(resolveBashToolWorkdir(), inputPath);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function readFileForTool(input: ReadFileInput) {
  const absolutePath = resolveToWorkdir(input.path);

  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isErrnoException(error)) {
      if (error.code === "ENOENT") {
        throw new Error(`文件不存在：${absolutePath}`);
      }
      if (error.code === "EISDIR") {
        throw new Error(`${absolutePath} 是目录，无法作为文件读取。`);
      }
    }
    throw error;
  }

  const allLines = raw.split("\n");
  const totalLines = allLines.length;

  const startIndex = Math.max(0, (input.offset ?? 1) - 1);
  const requestedEnd =
    input.limit != null ? startIndex + input.limit : totalLines;
  const endIndex = Math.min(requestedEnd, totalLines, startIndex + FILE_READ_MAX_LINES);

  let content = allLines.slice(startIndex, endIndex).join("\n");
  let truncatedReason: "lines" | "bytes" | null = null;

  if (endIndex < totalLines && endIndex < requestedEnd) {
    // 命中行数上限，且文件还有后续内容。
    truncatedReason = "lines";
  }

  if (Buffer.byteLength(content, "utf8") > FILE_READ_MAX_BYTES) {
    // 字节优先：先按字节截断，再据此回算实际覆盖到的行数。
    content = Buffer.from(content, "utf8")
      .subarray(0, FILE_READ_MAX_BYTES)
      .toString("utf8");
    truncatedReason = "bytes";
  }

  const coveredLines = content.length === 0 ? 0 : content.split("\n").length;
  const endLine = startIndex + coveredLines;
  const hasMore = endLine < totalLines;

  return {
    path: absolutePath,
    content,
    startLine: startIndex + 1,
    endLine,
    totalLines,
    truncated: truncatedReason != null,
    ...(truncatedReason ? { truncatedReason } : {}),
    ...(hasMore ? { hasMore: true, nextOffset: endLine + 1 } : {}),
  };
}

export async function writeFileForTool(input: WriteFileInput) {
  const absolutePath = resolveToWorkdir(input.path);
  const bytes = Buffer.byteLength(input.content, "utf8");

  if (bytes > FILE_WRITE_MAX_BYTES) {
    throw new Error(
      `写入内容过大（${bytes} 字节，上限 ${FILE_WRITE_MAX_BYTES} 字节）。`,
    );
  }

  let existed = false;
  try {
    await access(absolutePath);
    existed = true;
  } catch {
    // 文件不存在，按新建处理。
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.content, "utf8");

  return {
    path: absolutePath,
    bytesWritten: bytes,
    created: !existed,
  };
}

export async function editFileForTool(input: EditFileInput) {
  const absolutePath = resolveToWorkdir(input.path);

  const fileStat = await stat(absolutePath).catch((error) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(`文件不存在，无法编辑：${absolutePath}`);
    }
    throw error;
  });

  if (!fileStat.isFile()) {
    throw new Error(`${absolutePath} 不是普通文件，无法编辑。`);
  }

  const original = await readFile(absolutePath, "utf8");

  // 每个 oldText 都针对原文匹配，要求唯一；再校验各替换区间互不重叠。
  const matches = input.edits.map((edit, index) => {
    const first = original.indexOf(edit.oldText);
    if (first === -1) {
      throw new Error(`第 ${index + 1} 处 oldText 在文件中找不到。`);
    }
    const second = original.indexOf(edit.oldText, first + 1);
    if (second !== -1) {
      throw new Error(
        `第 ${index + 1} 处 oldText 在文件中不唯一，请补充上下文使其唯一。`,
      );
    }
    return { start: first, end: first + edit.oldText.length, newText: edit.newText };
  });

  matches.sort((a, b) => a.start - b.start);
  for (let i = 1; i < matches.length; i += 1) {
    if (matches[i].start < matches[i - 1].end) {
      throw new Error("存在重叠或嵌套的编辑区间，请将相邻改动合并为一条 edit。");
    }
  }

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += original.slice(cursor, match.start) + match.newText;
    cursor = match.end;
  }
  result += original.slice(cursor);

  await writeFile(absolutePath, result, "utf8");

  return {
    path: absolutePath,
    editsApplied: matches.length,
    bytesWritten: Buffer.byteLength(result, "utf8"),
  };
}
