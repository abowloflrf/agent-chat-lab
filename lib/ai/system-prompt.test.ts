import { describe, it, expect } from "vitest";
import {
  buildMcpContextPrompt,
  buildSkillContextPrompt,
  buildTimeContextPrompt,
  systemPrompt,
  systemPromptSections,
} from "@/lib/ai/system-prompt";

describe("systemPrompt", () => {
  it("is a non-empty string", () => {
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt.length).toBeGreaterThan(0);
  });

  it("includes the content of every section", () => {
    for (const section of systemPromptSections) {
      expect(systemPrompt).toContain(section);
    }
  });

  it("joins the sections with a blank line separator", () => {
    expect(systemPrompt).toBe(systemPromptSections.join("\n\n"));
  });

  it("exposes the expected number of sections", () => {
    expect(systemPromptSections).toHaveLength(3);
  });
});

describe("buildMcpContextPrompt", () => {
  it("returns an empty string when there are no servers", () => {
    expect(buildMcpContextPrompt([])).toBe("");
  });

  it("returns an empty string when every server has no tools", () => {
    expect(
      buildMcpContextPrompt([
        { serverName: "alpha", toolNames: [] },
        { serverName: "beta", toolNames: [] },
      ]),
    ).toBe("");
  });

  it("renders a line per server joining tools with a Chinese comma", () => {
    const result = buildMcpContextPrompt([
      { serverName: "alpha", toolNames: ["one", "two"] },
    ]);
    expect(result).toContain("- alpha: one、two");
  });

  it("renders a single tool without any separator", () => {
    const result = buildMcpContextPrompt([
      { serverName: "solo", toolNames: ["only"] },
    ]);
    expect(result).toContain("- solo: only");
    expect(result).not.toContain("、");
  });

  it("filters out servers that have no tools but keeps the rest", () => {
    const result = buildMcpContextPrompt([
      { serverName: "empty", toolNames: [] },
      { serverName: "full", toolNames: ["a", "b"] },
    ]);
    expect(result).toContain("- full: a、b");
    expect(result).not.toContain("empty");
  });

  it("emits one line per non-empty server in order", () => {
    const result = buildMcpContextPrompt([
      { serverName: "first", toolNames: ["x"] },
      { serverName: "second", toolNames: ["y", "z"] },
    ]);
    const lines = result
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(lines).toEqual(["- first: x", "- second: y、z"]);
  });

  it("drops an empty server sitting between two non-empty servers while preserving order", () => {
    const result = buildMcpContextPrompt([
      { serverName: "a", toolNames: ["t1"] },
      { serverName: "mid", toolNames: [] },
      { serverName: "b", toolNames: ["t2"] },
    ]);
    const lines = result
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(lines).toEqual(["- a: t1", "- b: t2"]);
    expect(result).not.toContain("mid");
  });

  it("joins three or more tools with the Chinese comma", () => {
    const result = buildMcpContextPrompt([
      { serverName: "s", toolNames: ["a", "b", "c"] },
    ]);
    expect(result).toContain("- s: a、b、c");
  });

  it("renders exactly the header line, one tool line, and the disclaimer line", () => {
    const result = buildMcpContextPrompt([
      { serverName: "alpha", toolNames: ["one", "two"] },
    ]);
    expect(result).toBe(
      "本轮额外提供以下 MCP 工具，与内置工具同等，可直接调用：\n" +
        "- alpha: one、two\n" +
        "工具结果存疑时说明局限，不编造内容。",
    );
  });

  it("includes the framing header and trailing disclaimer", () => {
    const result = buildMcpContextPrompt([
      { serverName: "alpha", toolNames: ["one"] },
    ]);
    expect(result).toContain("本轮额外提供以下 MCP 工具");
    expect(result).toContain("工具结果存疑时说明局限，不编造内容。");
  });

  it("returns a trimmed string (no leading/trailing whitespace)", () => {
    const result = buildMcpContextPrompt([
      { serverName: "alpha", toolNames: ["one"] },
    ]);
    expect(result).toBe(result.trim());
  });
});

describe("buildSkillContextPrompt", () => {
  it("returns an empty string when there are no skills", () => {
    expect(buildSkillContextPrompt([])).toBe("");
  });

  it("wraps the entries in an <available_skills> block", () => {
    const result = buildSkillContextPrompt([
      { name: "deploy", description: "ships the app" },
    ]);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("</available_skills>");
  });

  it("renders a name and description for each skill", () => {
    const result = buildSkillContextPrompt([
      { name: "deploy", description: "ships the app" },
      { name: "review", description: "reviews a PR" },
    ]);
    expect(result).toContain("<name>deploy</name>");
    expect(result).toContain("<description>ships the app</description>");
    expect(result).toContain("<name>review</name>");
    expect(result).toContain("<description>reviews a PR</description>");
  });

  it("emits a <skill> wrapper for every skill", () => {
    const result = buildSkillContextPrompt([
      { name: "a", description: "first" },
      { name: "b", description: "second" },
    ]);
    const openCount = result.split("<skill>").length - 1;
    const closeCount = result.split("</skill>").length - 1;
    expect(openCount).toBe(2);
    expect(closeCount).toBe(2);
  });

  it("includes the guidance lines about matching skills", () => {
    const result = buildSkillContextPrompt([
      { name: "deploy", description: "ships the app" },
    ]);
    expect(result).toContain(
      "Skills provide specialized instructions and workflows for specific tasks.",
    );
    expect(result).toContain("call the Skill tool with that skill's name");
  });

  it("renders the exact indented <skill> block structure for a single skill", () => {
    const result = buildSkillContextPrompt([{ name: "n", description: "d" }]);
    expect(result).toBe(
      [
        "Skills provide specialized instructions and workflows for specific tasks.",
        "When the user's task matches a skill's description, call the Skill tool with that skill's name to load its full instructions, then follow them. If nothing matches, proceed normally — do not invoke a skill just to use one.",
        "<available_skills>",
        "  <skill>",
        "    <name>n</name>",
        "    <description>d</description>",
        "  </skill>",
        "</available_skills>",
      ].join("\n"),
    );
  });

  it("emits skills in input order", () => {
    const result = buildSkillContextPrompt([
      { name: "first", description: "1" },
      { name: "second", description: "2" },
    ]);
    expect(result.indexOf("<name>first</name>")).toBeLessThan(
      result.indexOf("<name>second</name>"),
    );
  });

  it("has no leading or trailing whitespace and ends with the closing tag", () => {
    const result = buildSkillContextPrompt([
      { name: "deploy", description: "ships the app" },
    ]);
    expect(result).toBe(result.trim());
    expect(
      result.startsWith(
        "Skills provide specialized instructions and workflows for specific tasks.",
      ),
    ).toBe(true);
    expect(result.endsWith("</available_skills>")).toBe(true);
  });

  // KNOWN GAP: skill name/description are interpolated raw into the XML-ish
  // block with NO escaping. A description containing "</description>" (or any
  // angle brackets) is injected verbatim and corrupts the structure — a prompt
  // structure / injection hazard. This pins the current (unescaped) behavior;
  // if escaping is added, update this assertion.
  it("interpolates skill description verbatim without escaping angle brackets", () => {
    const result = buildSkillContextPrompt([
      { name: "x", description: "a </description> b" },
    ]);
    expect(result).toContain("<description>a </description> b</description>");
  });
});

describe("buildTimeContextPrompt", () => {
  it("includes both the datetime and ISO strings passed in", () => {
    const dt = "2026-06-19 14:30:00";
    const iso = "2026-06-19T06:30:00.000Z";
    const result = buildTimeContextPrompt(dt, iso);
    expect(result).toContain(dt);
    expect(result).toContain(iso);
  });

  it("labels the system time with the Asia/Shanghai zone", () => {
    const result = buildTimeContextPrompt("now", "iso");
    expect(result).toContain("当前系统时间（Asia/Shanghai）: now");
    expect(result).toContain("当前 ISO 时间: iso");
  });

  it("returns a trimmed string (no leading/trailing whitespace)", () => {
    const result = buildTimeContextPrompt("now", "iso");
    expect(result).toBe(result.trim());
  });

  it("handles empty string inputs without throwing", () => {
    const result = buildTimeContextPrompt("", "");
    expect(result).toContain("当前系统时间（Asia/Shanghai）: ");
    expect(result).toContain("当前 ISO 时间: ");
  });

  it("starts with the time-context header and includes the relative-time guidance line", () => {
    const result = buildTimeContextPrompt("now", "iso");
    expect(result.startsWith("时间补充：")).toBe(true);
    expect(result).toContain(
      '回答"今天""昨天""明天""本周""最近"等相对时间问题时，以这里的时间为准',
    );
  });
});

describe("systemPrompt section ordering", () => {
  it("orders identity before behavior before capability boundary", () => {
    const [identity, behavior, boundary] = systemPromptSections;
    const idx = (s: string) => systemPrompt.indexOf(s);
    expect(idx(identity)).toBeLessThan(idx(behavior));
    expect(idx(behavior)).toBeLessThan(idx(boundary));
  });

  it("begins with the core identity section", () => {
    expect(systemPrompt.startsWith(systemPromptSections[0])).toBe(true);
  });
});
