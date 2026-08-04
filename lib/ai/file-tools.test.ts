import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FILE_READ_MAX_BYTES,
  FILE_READ_MAX_LINES,
  FILE_WRITE_MAX_BYTES,
  editFileForTool,
  readFileForTool,
  writeFileForTool,
} from "@/lib/ai/file-tools";

// All cases pass absolute paths (temp dirs under os.tmpdir()); absolute paths are
// used as-is in the source, so they bypass the Bash tool's cwd resolution logic.
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "file-tools-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileForTool", () => {
  it("creates a new file and reports created:true with bytesWritten", async () => {
    const path = join(dir, "new.txt");
    const result = await writeFileForTool({ path, content: "hello" });

    expect(result.created).toBe(true);
    expect(result.bytesWritten).toBe(5);
    expect(result.path).toBe(path);
    expect(await readFile(path, "utf8")).toBe("hello");
  });

  it("counts bytesWritten as UTF-8 byte length, not character count", async () => {
    const path = join(dir, "utf8.txt");
    // Each CJK char is 3 UTF-8 bytes, so this 2-char string is 6 bytes, not 2.
    const result = await writeFileForTool({ path, content: "你好" });

    expect(result.bytesWritten).toBe(6);
    expect(result.created).toBe(true);
  });

  it("overwrites an existing file and reports created:false", async () => {
    const path = join(dir, "existing.txt");
    await writeFile(path, "old", "utf8");

    const result = await writeFileForTool({ path, content: "brand new" });

    expect(result.created).toBe(false);
    expect(result.bytesWritten).toBe(9);
    expect(await readFile(path, "utf8")).toBe("brand new");
  });

  it("creates missing parent directories and returns the absolute path", async () => {
    const path = join(dir, "deep", "nested", "child.txt");
    const result = await writeFileForTool({ path, content: "x" });

    expect(result.created).toBe(true);
    expect(result.path).toBe(path);
    expect(result.bytesWritten).toBe(1);
    expect(await readFile(path, "utf8")).toBe("x");
  });

  it("writes empty content (bytesWritten 0) and still reports created:true", async () => {
    const path = join(dir, "empty.txt");
    const result = await writeFileForTool({ path, content: "" });

    expect(result.created).toBe(true);
    expect(result.bytesWritten).toBe(0);
    expect(await readFile(path, "utf8")).toBe("");
  });

  it("allows content exactly at FILE_WRITE_MAX_BYTES", async () => {
    const path = join(dir, "max.txt");
    const content = "a".repeat(FILE_WRITE_MAX_BYTES);
    const result = await writeFileForTool({ path, content });

    expect(result.bytesWritten).toBe(FILE_WRITE_MAX_BYTES);
    expect(result.created).toBe(true);
  });

  it("throws when content exceeds FILE_WRITE_MAX_BYTES", async () => {
    const path = join(dir, "toobig.txt");
    const content = "a".repeat(FILE_WRITE_MAX_BYTES + 1);

    await expect(writeFileForTool({ path, content })).rejects.toThrow(
      /写入内容过大/,
    );
  });
});

describe("readFileForTool", () => {
  it("reads a full file with content, totalLines, startLine and endLine", async () => {
    const path = join(dir, "three.txt");
    await writeFile(path, "a\nb\nc", "utf8");

    const result = await readFileForTool({ path });

    expect(result.content).toBe("a\nb\nc");
    expect(result.totalLines).toBe(3);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.path).toBe(path);
    // A full read should not include pagination fields.
    expect("hasMore" in result).toBe(false);
    expect("nextOffset" in result).toBe(false);
    expect("truncatedReason" in result).toBe(false);
  });

  it("treats a trailing newline as an extra empty final line", async () => {
    const path = join(dir, "trailing.txt");
    await writeFile(path, "a\nb\n", "utf8");

    const result = await readFileForTool({ path });

    // "a\nb\n".split("\n") -> ["a", "b", ""] -> 3 lines.
    expect(result.totalLines).toBe(3);
    expect(result.content).toBe("a\nb\n");
  });

  it("slices lines with a 1-based offset", async () => {
    const path = join(dir, "lines.txt");
    await writeFile(path, "l1\nl2\nl3\nl4\nl5", "utf8");

    const result = await readFileForTool({ path, offset: 3 });

    expect(result.startLine).toBe(3);
    expect(result.content).toBe("l3\nl4\nl5");
    expect(result.endLine).toBe(5);
    expect(result.totalLines).toBe(5);
    expect("hasMore" in result).toBe(false);
  });

  it("applies offset + limit and exposes hasMore + nextOffset", async () => {
    const path = join(dir, "paged.txt");
    await writeFile(path, "l1\nl2\nl3\nl4\nl5", "utf8");

    const result = await readFileForTool({ path, offset: 2, limit: 2 });

    expect(result.startLine).toBe(2);
    expect(result.content).toBe("l2\nl3");
    expect(result.endLine).toBe(3);
    expect(result.truncated).toBe(false);
    // limit is not a line truncation, but pagination is still reported when more remains.
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(4);
    expect("truncatedReason" in result).toBe(false);
  });

  it("clamps a non-positive offset to the first line", async () => {
    const path = join(dir, "clamp.txt");
    await writeFile(path, "x\ny\nz", "utf8");

    // offset 0 -> startIndex = max(0, -1) = 0 -> startLine 1.
    const result = await readFileForTool({ path, offset: 0 });

    expect(result.startLine).toBe(1);
    expect(result.content).toBe("x\ny\nz");
  });

  it("truncates by lines when the file exceeds FILE_READ_MAX_LINES", async () => {
    const path = join(dir, "huge.txt");
    // 2500 lines (no trailing newline, so exactly 2500 lines).
    const total = 2500;
    const fileContent = Array.from({ length: total }, (_, i) => `line${i + 1}`).join(
      "\n",
    );
    await writeFile(path, fileContent, "utf8");

    const result = await readFileForTool({ path });

    expect(result.totalLines).toBe(total);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe("lines");
    // Only the first 2000 lines are covered.
    expect(result.content.split("\n").length).toBe(2000);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(2000);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(2001);
  });

  it("does NOT truncate a file with exactly FILE_READ_MAX_LINES lines", async () => {
    const path = join(dir, "exact.txt");
    // Exactly 2000 lines (no trailing newline); endIndex hits 2000 == totalLines, so not truncated.
    const fileContent = Array.from(
      { length: FILE_READ_MAX_LINES },
      (_, i) => `L${i + 1}`,
    ).join("\n");
    await writeFile(path, fileContent, "utf8");

    const result = await readFileForTool({ path });

    expect(result.totalLines).toBe(FILE_READ_MAX_LINES);
    expect(result.truncated).toBe(false);
    expect("truncatedReason" in result).toBe(false);
    expect(result.endLine).toBe(FILE_READ_MAX_LINES);
    expect("hasMore" in result).toBe(false);
  });

  it("truncates by lines when limit alone exceeds FILE_READ_MAX_LINES", async () => {
    const path = join(dir, "limit-over-max.txt");
    const total = 2500;
    const fileContent = Array.from({ length: total }, (_, i) => `L${i + 1}`).join(
      "\n",
    );
    await writeFile(path, fileContent, "utf8");

    // requestedEnd = 0 + 2500, but endIndex is capped at FILE_READ_MAX_LINES (2000);
    // endIndex < totalLines and endIndex < requestedEnd -> line truncation.
    const result = await readFileForTool({ path, limit: total });

    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe("lines");
    expect(result.endLine).toBe(FILE_READ_MAX_LINES);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(FILE_READ_MAX_LINES + 1);
  });

  it("does not truncate when limit runs past EOF (reads to the last line)", async () => {
    const path = join(dir, "limit-past-eof.txt");
    await writeFile(path, "a\nb\nc", "utf8");

    // limit 100 far exceeds remaining lines -> requestedEnd 100, but endIndex = totalLines = 3.
    const result = await readFileForTool({ path, limit: 100 });

    expect(result.content).toBe("a\nb\nc");
    expect(result.endLine).toBe(3);
    expect(result.totalLines).toBe(3);
    expect(result.truncated).toBe(false);
    expect("hasMore" in result).toBe(false);
  });

  it("truncates by bytes for a single line larger than FILE_READ_MAX_BYTES", async () => {
    const path = join(dir, "byte-single.txt");
    // Single ASCII line over the byte cap; no newline -> totalLines 1.
    await writeFile(path, "x".repeat(FILE_READ_MAX_BYTES + 100), "utf8");

    const result = await readFileForTool({ path });

    // Bytes take priority: content is cut exactly at the byte cap (all ASCII -> chars == bytes).
    expect(Buffer.byteLength(result.content, "utf8")).toBe(FILE_READ_MAX_BYTES);
    expect(result.content.length).toBe(FILE_READ_MAX_BYTES);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe("bytes");
    expect(result.totalLines).toBe(1);
    expect(result.startLine).toBe(1);
    // content is still one line (no newline), coveredLines = 1 -> endLine 1 == totalLines.
    expect(result.endLine).toBe(1);
    // endLine already equals totalLines, so no pagination fields.
    expect("hasMore" in result).toBe(false);
    expect("nextOffset" in result).toBe(false);
  });

  it("truncates by bytes across many lines and recomputes covered lines + pagination", async () => {
    const path = join(dir, "byte-multi.txt");
    // 1500 lines, 199 chars + newline ~= 200 bytes/line, ~300KB, well over the
    // byte cap, but 1500 lines < 2000, so byte truncation happens first.
    const line = "z".repeat(199);
    const fileContent = Array.from({ length: 1500 }, () => line).join("\n");
    await writeFile(path, fileContent, "utf8");

    const result = await readFileForTool({ path });

    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe("bytes");
    expect(Buffer.byteLength(result.content, "utf8")).toBe(FILE_READ_MAX_BYTES);
    expect(result.totalLines).toBe(1500);
    // Covered lines are recomputed from the byte-truncated content; should be < total and > 1.
    const covered = result.content.split("\n").length;
    expect(covered).toBeGreaterThan(1);
    expect(covered).toBeLessThan(1500);
    expect(result.endLine).toBe(covered);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(covered + 1);
  });

  // KNOWN GAP: byte truncation slices a raw UTF-8 Buffer at a fixed byte
  // boundary, so a multibyte char straddling the cut is decoded to the 3-byte
  // U+FFFD replacement char. The resulting string can therefore exceed
  // FILE_READ_MAX_BYTES (the "byte cap" is not actually honored when the cut
  // splits a multibyte sequence). Pinning current behavior.
  it("byte truncation can exceed the cap when it splits a multibyte char", async () => {
    const path = join(dir, "byte-multibyte.txt");
    // (MAX-1) ASCII chars + one 3-byte CJK char, so the cut falls mid-character.
    const fileContent = "a".repeat(FILE_READ_MAX_BYTES - 1) + "好";
    await writeFile(path, fileContent, "utf8");

    const result = await readFileForTool({ path });

    expect(result.truncatedReason).toBe("bytes");
    // The tail becomes U+FFFD, pushing the byte count over the nominal cap.
    expect(result.content.endsWith("�")).toBe(true);
    expect(Buffer.byteLength(result.content, "utf8")).toBeGreaterThan(
      FILE_READ_MAX_BYTES,
    );
  });

  // KNOWN GAP: an empty file is "a\nb"-style split into [""] -> totalLines 1,
  // but covered content is "" so coveredLines is 0 and endLine becomes 0
  // (< startLine). Because endLine(0) < totalLines(1), it also (mis)reports
  // hasMore:true / nextOffset:1 even though there is nothing more to read.
  it("reports endLine 0 and hasMore:true for an empty file (quirk)", async () => {
    const path = join(dir, "empty-read.txt");
    await writeFile(path, "", "utf8");

    const result = await readFileForTool({ path });

    expect(result.content).toBe("");
    expect(result.totalLines).toBe(1);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(1);
  });

  // KNOWN GAP: an offset past EOF yields empty content but endLine is computed
  // as startIndex + coveredLines. With coveredLines 0 it equals startIndex,
  // which can be GREATER than totalLines (here endLine 9 > totalLines 3) — an
  // internally inconsistent but non-throwing result. Pinning current behavior.
  it("returns empty content with endLine past totalLines for an offset beyond EOF", async () => {
    const path = join(dir, "offset-past-eof.txt");
    await writeFile(path, "a\nb\nc", "utf8");

    const result = await readFileForTool({ path, offset: 10 });

    expect(result.content).toBe("");
    expect(result.startLine).toBe(10);
    expect(result.endLine).toBe(9);
    expect(result.totalLines).toBe(3);
    expect(result.truncated).toBe(false);
    // endLine(9) > totalLines(3) -> hasMore is false, no pagination fields.
    expect("hasMore" in result).toBe(false);
  });

  it("throws a 'file not found' error for a missing path", async () => {
    const path = join(dir, "does-not-exist.txt");

    await expect(readFileForTool({ path })).rejects.toThrow(/文件不存在/);
  });

  it("throws when the path is a directory (EISDIR)", async () => {
    const subdir = join(dir, "subdir");
    await mkdir(subdir);

    await expect(readFileForTool({ path: subdir })).rejects.toThrow(
      /是目录，无法作为文件读取/,
    );
  });
});

describe("editFileForTool", () => {
  it("applies a single unique edit", async () => {
    const path = join(dir, "single.txt");
    await writeFile(path, "hello world", "utf8");

    const result = await editFileForTool({
      path,
      edits: [{ oldText: "world", newText: "there" }],
    });

    expect(result.editsApplied).toBe(1);
    expect(result.bytesWritten).toBe(Buffer.byteLength("hello there", "utf8"));
    expect(await readFile(path, "utf8")).toBe("hello there");
  });

  it("applies multiple non-overlapping edits in original order regardless of input order", async () => {
    const path = join(dir, "multi.txt");
    await writeFile(path, "AAA BBB CCC", "utf8");

    // Intentionally put the later edit first to verify edits are sorted by original position.
    const result = await editFileForTool({
      path,
      edits: [
        { oldText: "CCC", newText: "ccc" },
        { oldText: "AAA", newText: "aaa" },
      ],
    });

    expect(result.editsApplied).toBe(2);
    expect(await readFile(path, "utf8")).toBe("aaa BBB ccc");
  });

  it("matches oldText against the original text, not the partially-edited result", async () => {
    const path = join(dir, "original.txt");
    await writeFile(path, "foo bar", "utf8");

    // Both match against the original; if foo->bar were applied first, "bar" would be non-unique,
    // but the source matches against the original text, so both hold independently.
    const result = await editFileForTool({
      path,
      edits: [
        { oldText: "foo", newText: "X" },
        { oldText: "bar", newText: "Y" },
      ],
    });

    expect(result.editsApplied).toBe(2);
    expect(await readFile(path, "utf8")).toBe("X Y");
  });

  it("throws when oldText is not found", async () => {
    const path = join(dir, "notfound.txt");
    await writeFile(path, "hello world", "utf8");

    await expect(
      editFileForTool({
        path,
        edits: [{ oldText: "missing", newText: "x" }],
      }),
    ).rejects.toThrow(/oldText 在文件中找不到/);
  });

  it("throws when oldText is not unique", async () => {
    const path = join(dir, "dup.txt");
    await writeFile(path, "ab ab ab", "utf8");

    await expect(
      editFileForTool({
        path,
        edits: [{ oldText: "ab", newText: "x" }],
      }),
    ).rejects.toThrow(/oldText 在文件中不唯一/);
  });

  it("treats an empty oldText as non-unique (matches at every position)", async () => {
    const path = join(dir, "empty-old.txt");
    await writeFile(path, "abc", "utf8");

    // indexOf("") === 0 and indexOf("", 1) === 1 -> a second match -> non-unique.
    await expect(
      editFileForTool({
        path,
        edits: [{ oldText: "", newText: "x" }],
      }),
    ).rejects.toThrow(/oldText 在文件中不唯一/);
  });

  it("deletes a region when newText is empty", async () => {
    const path = join(dir, "delete.txt");
    await writeFile(path, "keep REMOVE keep", "utf8");

    const result = await editFileForTool({
      path,
      edits: [{ oldText: " REMOVE", newText: "" }],
    });

    expect(result.editsApplied).toBe(1);
    expect(await readFile(path, "utf8")).toBe("keep keep");
    expect(result.bytesWritten).toBe(Buffer.byteLength("keep keep", "utf8"));
  });

  it("computes bytesWritten as UTF-8 length of the edited result (multibyte)", async () => {
    const path = join(dir, "edit-utf8.txt");
    await writeFile(path, "hi name", "utf8");

    const result = await editFileForTool({
      path,
      edits: [{ oldText: "name", newText: "世界" }],
    });

    const expected = "hi 世界";
    expect(await readFile(path, "utf8")).toBe(expected);
    // 2 CJK chars (6 bytes) + "hi " (3 bytes) = 9 bytes total.
    expect(result.bytesWritten).toBe(Buffer.byteLength(expected, "utf8"));
    expect(result.bytesWritten).toBe(9);
  });

  it("returns the absolute path of the edited file", async () => {
    const path = join(dir, "edit-path.txt");
    await writeFile(path, "one two", "utf8");

    const result = await editFileForTool({
      path,
      edits: [{ oldText: "two", newText: "2" }],
    });

    expect(result.path).toBe(path);
  });

  it("first failing edit aborts the whole batch (no partial write)", async () => {
    const path = join(dir, "atomic.txt");
    await writeFile(path, "alpha beta", "utf8");

    // The second oldText is not found -> the whole batch throws, file stays unchanged.
    await expect(
      editFileForTool({
        path,
        edits: [
          { oldText: "alpha", newText: "A" },
          { oldText: "missing", newText: "Z" },
        ],
      }),
    ).rejects.toThrow(/oldText 在文件中找不到/);

    expect(await readFile(path, "utf8")).toBe("alpha beta");
  });

  it("throws when two edits target the same (duplicated) region", async () => {
    const path = join(dir, "overlap-dup.txt");
    await writeFile(path, "hello", "utf8");

    // Each edit's oldText is unique, but they match the same region -> overlap.
    await expect(
      editFileForTool({
        path,
        edits: [
          { oldText: "hello", newText: "a" },
          { oldText: "hello", newText: "b" },
        ],
      }),
    ).rejects.toThrow(/重叠或嵌套的编辑区间/);
  });

  it("throws when two edits target overlapping (nested) regions", async () => {
    const path = join(dir, "overlap-nested.txt");
    await writeFile(path, "abcdef", "utf8");

    // "abcd" and "cdef" regions overlap (c, d coincide).
    await expect(
      editFileForTool({
        path,
        edits: [
          { oldText: "abcd", newText: "x" },
          { oldText: "cdef", newText: "y" },
        ],
      }),
    ).rejects.toThrow(/重叠或嵌套的编辑区间/);
  });

  it("allows adjacent (touching but non-overlapping) edits", async () => {
    const path = join(dir, "adjacent.txt");
    await writeFile(path, "abcdef", "utf8");

    // "abc" ends at index 3, "def" starts at index 3 -> adjacent, not overlapping.
    const result = await editFileForTool({
      path,
      edits: [
        { oldText: "abc", newText: "X" },
        { oldText: "def", newText: "Y" },
      ],
    });

    expect(result.editsApplied).toBe(2);
    expect(await readFile(path, "utf8")).toBe("XY");
  });

  it("throws a 'file not found' error for a missing file", async () => {
    const path = join(dir, "ghost.txt");

    await expect(
      editFileForTool({
        path,
        edits: [{ oldText: "a", newText: "b" }],
      }),
    ).rejects.toThrow(/文件不存在/);
  });

  it("throws when the path is a directory (not a regular file)", async () => {
    const subdir = join(dir, "adir");
    await mkdir(subdir);

    await expect(
      editFileForTool({
        path: subdir,
        edits: [{ oldText: "a", newText: "b" }],
      }),
    ).rejects.toThrow(/不是普通文件，无法编辑/);
  });
});
