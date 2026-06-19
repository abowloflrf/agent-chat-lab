import { describe, it, expect } from "vitest";
import type { ToolCallRepairFunction, ToolSet } from "ai";
import { repairToolCall } from "@/lib/ai/repair-tool-call";

// The exported repair function only ever reads the KEYS of `tools`, so an empty
// object per key is a faithful stand-in for a real ToolSet entry.
const toolSet = (...names: string[]): ToolSet =>
  Object.fromEntries(names.map((n) => [n, {}])) as unknown as ToolSet;

// Default local toolset used across most cases.
const TOOLS = toolSet("read", "write", "edit");

// Helper to invoke the repair function with the minimum shape the function reads.
type RepairArgs = Parameters<ToolCallRepairFunction<ToolSet>>[0];
type ToolCall = RepairArgs["toolCall"];

const call = (
  toolName: string,
  input: string,
  opts: { tools?: ToolSet; toolCallId?: string } = {},
) => {
  const toolCall = {
    toolCallId: opts.toolCallId ?? "tc-1",
    toolName,
    input,
  } as unknown as ToolCall;
  return repairToolCall({
    toolCall,
    tools: opts.tools ?? TOOLS,
  } as RepairArgs);
};

// Narrow the union return type to a concrete object for assertions.
function expectFixed(result: Awaited<ReturnType<typeof call>>) {
  expect(result).not.toBeNull();
  if (!result) throw new Error("expected a non-null repair result");
  return result;
}

describe("repairToolCall — name resolution", () => {
  it("returns null when nothing needs fixing (exact name, no remappable args)", async () => {
    const result = await call("read", JSON.stringify({ path: "/a" }));
    expect(result).toBeNull();
  });

  it("returns null for an unknown tool name with no alias", async () => {
    const result = await call("frobnicate", JSON.stringify({ path: "/a" }));
    expect(result).toBeNull();
  });

  it("corrects a case-insensitive name (Read -> read)", async () => {
    const result = expectFixed(await call("Read", JSON.stringify({ path: "/a" })));
    expect(result.toolName).toBe("read");
    expect(JSON.parse(result.input)).toEqual({ path: "/a" });
  });

  it("corrects an all-caps name (WRITE -> write)", async () => {
    const result = expectFixed(
      await call("WRITE", JSON.stringify({ path: "/a", content: "x" })),
    );
    expect(result.toolName).toBe("write");
  });

  it("is separator-insensitive (web_search -> websearch)", async () => {
    const tools = toolSet("websearch");
    const result = expectFixed(
      await call("web_search", JSON.stringify({ query: "hi" }), { tools }),
    );
    expect(result.toolName).toBe("websearch");
    expect(JSON.parse(result.input)).toEqual({ query: "hi" });
  });

  it("is separator-insensitive in the other direction (WebSearch -> web_search)", async () => {
    const tools = toolSet("web_search");
    const result = expectFixed(
      await call("WebSearch", JSON.stringify({ query: "hi" }), { tools }),
    );
    expect(result.toolName).toBe("web_search");
  });

  it("preserves the toolCallId on a corrected call", async () => {
    const result = expectFixed(
      await call("Read", JSON.stringify({ path: "/a" }), {
        toolCallId: "abc-123",
      }),
    );
    expect(result.toolCallId).toBe("abc-123");
  });

  it("preserves the toolCallId on an args-only fix (name already correct)", async () => {
    const result = expectFixed(
      await call("read", JSON.stringify({ file_path: "/a" }), {
        toolCallId: "args-only-7",
      }),
    );
    expect(result.toolName).toBe("read");
    expect(result.toolCallId).toBe("args-only-7");
    expect(JSON.parse(result.input)).toEqual({ path: "/a" });
  });

  it("returns null when the toolset is empty (no name can resolve)", async () => {
    const tools = toolSet();
    const result = await call("Read", JSON.stringify({ path: "/a" }), { tools });
    expect(result).toBeNull();
  });
});

describe("repairToolCall — aliases", () => {
  it.each([
    ["view", "read"],
    ["cat", "read"],
    ["str_replace", "edit"],
    ["str_replace_editor", "edit"],
    ["str_replace_based_edit_tool", "edit"],
    ["replace", "edit"],
  ])("maps alias %s -> %s", async (alias, expected) => {
    // Use an input that won't be remapped (no aliased arg keys) so we isolate
    // the name mapping. `edit` aliases get an `edits` key already present.
    const input =
      expected === "edit"
        ? JSON.stringify({ path: "/a", edits: [] })
        : JSON.stringify({ path: "/a" });
    const result = expectFixed(await call(alias, input));
    expect(result.toolName).toBe(expected);
  });

  it("normalizes case/separators before alias lookup (STR-REPLACE -> edit)", async () => {
    const result = expectFixed(
      await call("STR-REPLACE", JSON.stringify({ path: "/a", edits: [] })),
    );
    expect(result.toolName).toBe("edit");
  });

  it("returns null when the aliased target tool is not available", async () => {
    // `view` aliases to `read`, but `read` is absent from this toolset.
    const tools = toolSet("write", "edit");
    const result = await call("view", JSON.stringify({ path: "/a" }), { tools });
    expect(result).toBeNull();
  });

  it("prefers an exact tool match over the alias table (replace stays replace)", async () => {
    // `replace` is an ALIAS for `edit`, but resolveToolName checks
    // available.includes(name) FIRST, so a tool literally named `replace`
    // resolves to itself and is NOT rewritten to `edit`.
    const tools = toolSet("read", "write", "edit", "replace");
    const result = await call("replace", JSON.stringify({ path: "/a" }), {
      tools,
    });
    // Exact name, no remappable args → nothing to fix → null.
    expect(result).toBeNull();
  });

  it("still applies arg remap (not alias) when an exact-named tool wins", async () => {
    // `replace` exists exactly; but it is not read/write/edit, so file_path is
    // NOT remapped. Confirms the alias is skipped and no remap fires → null.
    const tools = toolSet("read", "write", "edit", "replace");
    const result = await call(
      "replace",
      JSON.stringify({ file_path: "/a" }),
      { tools },
    );
    expect(result).toBeNull();
  });

  it("does NOT apply an alias when the normalized form already matches a real tool", async () => {
    // norm("str_replace") === "strreplace"; a tool literally named
    // "str_replace" (norm "strreplace") matches case/separator-insensitively
    // BEFORE the alias table, so it resolves to itself rather than to `edit`.
    const tools = toolSet("str_replace");
    const result = await call(
      "str_replace",
      JSON.stringify({ old_string: "foo", new_string: "bar" }),
      { tools },
    );
    // Resolves to "str_replace" (exact), which is not read/write/edit, so the
    // old_string→edits remap does not fire and nothing changes → null.
    expect(result).toBeNull();
  });
});

describe("repairToolCall — argument remapping (file_path -> path)", () => {
  it.each(["read", "write", "edit"])(
    "remaps file_path -> path for %s",
    async (tool) => {
      const result = expectFixed(
        await call(tool, JSON.stringify({ file_path: "/a/b.txt" })),
      );
      const parsed = JSON.parse(result.input);
      expect(parsed.path).toBe("/a/b.txt");
      expect("file_path" in parsed).toBe(false);
    },
  );

  it("remaps file_path even when the name is already correct (args-only fix)", async () => {
    const result = expectFixed(
      await call("read", JSON.stringify({ file_path: "/a" })),
    );
    expect(result.toolName).toBe("read");
    expect(JSON.parse(result.input)).toEqual({ path: "/a" });
  });

  it("does NOT overwrite an existing path when file_path is also present", async () => {
    const result = await call(
      "read",
      JSON.stringify({ file_path: "/a", path: "/b" }),
    );
    // Name already correct and remap is guarded by !("path" in args), so the
    // function finds nothing to fix and returns null.
    expect(result).toBeNull();
  });

  it("keeps file_path untouched for a tool that is not read/write/edit", async () => {
    const tools = toolSet("search");
    const result = await call(
      "search",
      JSON.stringify({ file_path: "/a" }),
      { tools },
    );
    // Name is exact, remap doesn't apply to `search`, so nothing to fix.
    expect(result).toBeNull();
  });
});

describe("repairToolCall — argument remapping (edit old_string/new_string -> edits)", () => {
  it("remaps old_string + new_string into edits:[{oldText,newText}]", async () => {
    const result = expectFixed(
      await call(
        "edit",
        JSON.stringify({
          file_path: "/a",
          old_string: "foo",
          new_string: "bar",
        }),
      ),
    );
    const parsed = JSON.parse(result.input);
    expect(parsed.path).toBe("/a");
    expect(parsed.edits).toEqual([{ oldText: "foo", newText: "bar" }]);
    expect("old_string" in parsed).toBe(false);
    expect("new_string" in parsed).toBe(false);
    expect("file_path" in parsed).toBe(false);
  });

  it("defaults newText to empty string when new_string is missing", async () => {
    const result = expectFixed(
      await call("edit", JSON.stringify({ old_string: "foo" })),
    );
    const parsed = JSON.parse(result.input);
    expect(parsed.edits).toEqual([{ oldText: "foo", newText: "" }]);
  });

  it("drops replace_all when remapping edits", async () => {
    const result = expectFixed(
      await call(
        "edit",
        JSON.stringify({
          old_string: "foo",
          new_string: "bar",
          replace_all: true,
        }),
      ),
    );
    const parsed = JSON.parse(result.input);
    expect("replace_all" in parsed).toBe(false);
    expect(parsed.edits).toEqual([{ oldText: "foo", newText: "bar" }]);
  });

  it("does NOT remap when only new_string is present (old_string is the trigger)", async () => {
    // The edit remap is gated on `"old_string" in args`; new_string alone is
    // not enough to trigger it, so with an exact name there is nothing to fix.
    const result = await call(
      "edit",
      JSON.stringify({ path: "/a", new_string: "bar" }),
    );
    expect(result).toBeNull();
  });

  it("remaps old_string alone even when name needs no fix, leaving new_string keys absent", async () => {
    // old_string present, new_string absent: edits get newText:"" and the stray
    // new_string delete is a no-op. Also verifies the leftover object is clean.
    const result = expectFixed(
      await call("Edit", JSON.stringify({ old_string: "foo" })),
    );
    expect(result.toolName).toBe("edit");
    const parsed = JSON.parse(result.input);
    expect(parsed.edits).toEqual([{ oldText: "foo", newText: "" }]);
    expect("old_string" in parsed).toBe(false);
    expect("new_string" in parsed).toBe(false);
  });

  it("keeps a falsy old_string value (empty string) by using `in`, not truthiness", async () => {
    // The guard is `"old_string" in args`, so an empty-string old_string still
    // triggers the remap (oldText:"").
    const result = expectFixed(
      await call("edit", JSON.stringify({ old_string: "", new_string: "x" })),
    );
    const parsed = JSON.parse(result.input);
    expect(parsed.edits).toEqual([{ oldText: "", newText: "x" }]);
  });

  it("does NOT remap old_string when edits already present", async () => {
    // Name already correct and the edit remap is guarded by !("edits" in args),
    // so with edits present there is nothing left to fix -> null.
    const result = await call(
      "edit",
      JSON.stringify({ old_string: "foo", edits: [{ oldText: "x", newText: "y" }] }),
    );
    expect(result).toBeNull();
  });

  it("applies alias + file_path remap without the edits remap when old_string is absent", async () => {
    // str_replace -> edit (alias), file_path -> path (remap), but no
    // old_string means the edits remap does not fire; result has no `edits`.
    const result = expectFixed(
      await call("str_replace", JSON.stringify({ file_path: "/a" })),
    );
    expect(result.toolName).toBe("edit");
    const parsed = JSON.parse(result.input);
    expect(parsed.path).toBe("/a");
    expect("file_path" in parsed).toBe(false);
    expect("edits" in parsed).toBe(false);
  });

  it("applies the full alias + remap chain (str_replace -> edit with edits)", async () => {
    const result = expectFixed(
      await call(
        "str_replace",
        JSON.stringify({
          file_path: "/a",
          old_string: "foo",
          new_string: "bar",
          replace_all: true,
        }),
      ),
    );
    expect(result.toolName).toBe("edit");
    const parsed = JSON.parse(result.input);
    expect(parsed.path).toBe("/a");
    expect(parsed.edits).toEqual([{ oldText: "foo", newText: "bar" }]);
    expect("replace_all" in parsed).toBe(false);
  });
});

describe("repairToolCall — invalid / non-object input", () => {
  it("corrects only the name when input is invalid JSON", async () => {
    const result = expectFixed(await call("Read", "{not valid json"));
    expect(result.toolName).toBe("read");
    // Only the name is corrected; the original (unparseable) input is spread
    // through verbatim because the return is { ...toolCall, toolName }.
    expect(result.input).toBe("{not valid json");
  });

  it("returns null on invalid JSON when the name is already correct", async () => {
    const result = await call("read", "{not valid json");
    expect(result).toBeNull();
  });

  it("treats empty-string input as an empty object (no fix needed -> null)", async () => {
    const result = await call("read", "");
    expect(result).toBeNull();
  });

  it("treats whitespace-only input as an empty object and still corrects the name", async () => {
    const result = expectFixed(await call("Read", "   "));
    expect(result.toolName).toBe("read");
    // Empty parsed object: name corrected, input re-serialized to "{}".
    expect(result.input).toBe("{}");
  });

  it("corrects only the name when input is a JSON array (non-object)", async () => {
    const result = expectFixed(await call("Read", JSON.stringify([1, 2, 3])));
    expect(result.toolName).toBe("read");
    // Array is valid JSON but not a remappable object: name fixed, input kept.
    expect(result.input).toBe(JSON.stringify([1, 2, 3]));
  });

  it("returns null when input is a JSON array and the name is already correct", async () => {
    const result = await call("read", JSON.stringify([1, 2, 3]));
    expect(result).toBeNull();
  });

  it("corrects only the name when input is a JSON number (non-object)", async () => {
    const result = expectFixed(await call("Read", "42"));
    expect(result.toolName).toBe("read");
    expect(result.input).toBe("42");
  });

  it("corrects only the name when input is JSON null (non-object)", async () => {
    const result = expectFixed(await call("Read", "null"));
    expect(result.toolName).toBe("read");
    expect(result.input).toBe("null");
  });

  it("returns null when input is JSON null and the name is already correct", async () => {
    const result = await call("read", "null");
    expect(result).toBeNull();
  });
});

describe("repairToolCall — no-op cases", () => {
  it("returns null when exact name and unrelated args (nothing to remap)", async () => {
    const result = await call(
      "edit",
      JSON.stringify({ path: "/a", edits: [{ oldText: "x", newText: "y" }] }),
    );
    expect(result).toBeNull();
  });

  it("returns null for an unknown tool even when input has remappable args", async () => {
    const result = await call(
      "frobnicate",
      JSON.stringify({ file_path: "/a" }),
    );
    expect(result).toBeNull();
  });
});
