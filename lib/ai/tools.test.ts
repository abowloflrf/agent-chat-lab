import { describe, it, expect } from "vitest";
import type { ToolCallOptions } from "ai";
import { createAgentTools } from "@/lib/ai/tools";
import type { ProviderConfig } from "@/lib/provider-config";

// A config with NO search provider keys, so WebSearch/WebFetch short-circuit
// before any network call.
const noSearchConfig: ProviderConfig = {
  providerName: "x",
  baseUrl: "https://x.example/v1",
  apiKey: "k",
  model: "m",
  protocol: "chat-completion",
  tavilyApiKey: "",
  exaApiKey: "",
};

// Tool.execute requires a ToolCallOptions second arg; our execute bodies ignore it.
const TOOL_OPTS = { toolCallId: "test", messages: [] } as unknown as ToolCallOptions;

describe("createAgentTools — exposed tool set", () => {
  it("exposes the built-in tools and omits Skill when no skills are enabled", () => {
    const names = Object.keys(createAgentTools(noSearchConfig));
    expect(names).toEqual(
      expect.arrayContaining([
        "AskUserQuestion",
        "calculator",
        "create_note",
        "search_notes",
        "TodoWrite",
        "TodoRead",
        "Bash",
        "read",
        "write",
        "edit",
        "WebSearch",
        "WebFetch",
      ]),
    );
    expect(names).not.toContain("Skill");
  });

  it("exposes the Skill tool when at least one skill is enabled", () => {
    const tools = createAgentTools(noSearchConfig, new Set(["my-skill"]));
    expect(Object.keys(tools)).toContain("Skill");
  });
});

describe("calculator tool", () => {
  function calc(expression: string) {
    return createAgentTools(noSearchConfig).calculator.execute!({ expression }, TOOL_OPTS);
  }

  it("evaluates basic arithmetic with precedence and parentheses", async () => {
    await expect(calc("1 + 2")).resolves.toEqual({ expression: "1 + 2", result: 3 });
    await expect(calc("(18.5 + 7.2) * 3")).resolves.toMatchObject({ result: 77.1 });
    await expect(calc("10 / 4")).resolves.toMatchObject({ result: 2.5 });
  });

  it("rejects expressions containing letters (blocks code execution)", async () => {
    await expect(calc("globalThis")).rejects.toThrow(/计算器/);
    await expect(calc("1 + a")).rejects.toThrow(/计算器/);
  });

  it("rejects statement separators and other non-allowlisted characters", async () => {
    // ';' is not in the allowlist, so injection attempts are refused.
    await expect(calc("1;2")).rejects.toThrow(/计算器/);
    await expect(calc("1,2")).rejects.toThrow(/计算器/);
  });

  it("rejects an empty expression", async () => {
    await expect(calc("   ")).rejects.toThrow(/不能为空/);
  });
});

describe("Bash tool needsApproval", () => {
  // The arrow is defined as (input) => assessBashCommand(input.command).decision === "approval".
  function needsApproval(command: string): boolean {
    const tool = createAgentTools(noSearchConfig).Bash;
    const fn = tool.needsApproval as (input: { command: string }) => boolean;
    return fn({ command });
  }

  it("does not require approval for a low-risk read-only command", () => {
    expect(needsApproval("ls -la")).toBe(false);
  });

  it("requires approval for a state-changing / high-risk command", () => {
    expect(needsApproval("chmod 777 file")).toBe(true);
    expect(needsApproval("cat a | grep b")).toBe(true);
  });

  it("does NOT flag denied commands for approval (they are rejected at execute time)", () => {
    expect(needsApproval("rm -rf x")).toBe(false);
  });
});

describe("WebSearch / WebFetch without a provider configured", () => {
  it("WebSearch returns an actionable error instead of calling out", async () => {
    const result = (await createAgentTools(noSearchConfig).WebSearch.execute!(
      {
        query: "anything",
        topic: "general",
        maxResults: 5,
        includeDomains: [],
        excludeDomains: [],
      },
      TOOL_OPTS,
    )) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No web search provider/);
  });

  it("WebFetch returns an actionable error instead of calling out", async () => {
    const result = (await createAgentTools(noSearchConfig).WebFetch.execute!(
      { urls: ["https://example.com"], extractDepth: "basic", format: "markdown" },
      TOOL_OPTS,
    )) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No web search provider/);
  });
});

describe("Skill tool gating", () => {
  it("refuses to load a skill that is not in the enabled set (no filesystem access)", async () => {
    const tools = createAgentTools(noSearchConfig, new Set(["allowed"]));
    const skill = tools.Skill as Extract<typeof tools.Skill, { execute: unknown }>;
    const result = (await skill.execute!({ name: "not-allowed" }, TOOL_OPTS)) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not available|disabled/);
  });
});
