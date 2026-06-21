import { describe, it, expect } from "vitest";
import {
  buildMcpContextPrompt,
  buildSkillContextPrompt,
  buildTimeContextPrompt,
  buildWebSearchContextPrompt,
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

  it("renders a line per server joining tools with a comma", () => {
    const result = buildMcpContextPrompt([
      { serverName: "alpha", toolNames: ["one", "two"] },
    ]);
    expect(result).toContain("- alpha: one, two");
  });

  it("renders a single tool without any separator", () => {
    const result = buildMcpContextPrompt([
      { serverName: "solo", toolNames: ["only"] },
    ]);
    expect(result).toContain("- solo: only");
  });

  it("filters out servers that have no tools but keeps the rest", () => {
    const result = buildMcpContextPrompt([
      { serverName: "empty", toolNames: [] },
      { serverName: "full", toolNames: ["a", "b"] },
    ]);
    expect(result).toContain("- full: a, b");
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
    expect(lines).toEqual(["- first: x", "- second: y, z"]);
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

  it("joins three or more tools with commas", () => {
    const result = buildMcpContextPrompt([
      { serverName: "s", toolNames: ["a", "b", "c"] },
    ]);
    expect(result).toContain("- s: a, b, c");
  });

  it("renders exactly the header line, one tool line, and the disclaimer line", () => {
    const result = buildMcpContextPrompt([
      { serverName: "alpha", toolNames: ["one", "two"] },
    ]);
    expect(result).toBe(
      "The following MCP tools are additionally available this turn; they are equivalent to the built-in tools and can be called directly:\n" +
        "- alpha: one, two\n" +
        "When tool results are doubtful, state the limitation and do not fabricate.",
    );
  });

  it("includes the framing header and trailing disclaimer", () => {
    const result = buildMcpContextPrompt([
      { serverName: "alpha", toolNames: ["one"] },
    ]);
    expect(result).toContain(
      "The following MCP tools are additionally available this turn",
    );
    expect(result).toContain(
      "When tool results are doubtful, state the limitation and do not fabricate.",
    );
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

  // Angle brackets and ampersands in name/description are escaped so a crafted
  // description cannot break out of (or forge) the <skill> block.
  it("escapes angle brackets in a skill description to prevent block corruption", () => {
    const result = buildSkillContextPrompt([
      { name: "x", description: "a </description> b" },
    ]);
    expect(result).toContain("<description>a &lt;/description&gt; b</description>");
    expect(result).not.toContain("a </description> b");
  });

  it("escapes angle brackets and ampersands in a skill name", () => {
    const result = buildSkillContextPrompt([
      { name: "a<b>&c", description: "d" },
    ]);
    expect(result).toContain("<name>a&lt;b&gt;&amp;c</name>");
  });
});

describe("buildWebSearchContextPrompt", () => {
  it("returns a non-empty, trimmed string", () => {
    const result = buildWebSearchContextPrompt();
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe(result.trim());
  });

  it("documents the inline citation marker format and the exact-URL rule", () => {
    const result = buildWebSearchContextPrompt();
    expect(result).toContain("[n](realURL)");
    expect(result).toContain(
      "The URL must be exactly the url returned by the tool",
    );
  });

  it("scopes the rule to turns where WebSearch or WebFetch was used", () => {
    const result = buildWebSearchContextPrompt();
    expect(result).toContain(
      "applies only when WebSearch or WebFetch was used this turn",
    );
  });
});

describe("buildTimeContextPrompt", () => {
  it("includes both the datetime and ISO strings passed in", () => {
    const dt = "2026-06-19 14:30:00";
    const iso = "2026-06-19T06:30:00.000Z";
    const result = buildTimeContextPrompt(dt, iso, "Asia/Shanghai");
    expect(result).toContain(dt);
    expect(result).toContain(iso);
  });

  it("labels the system time with the given time zone", () => {
    const result = buildTimeContextPrompt("now", "iso", "Asia/Shanghai");
    expect(result).toContain("Current system time (Asia/Shanghai): now");
    expect(result).toContain("Current ISO time: iso");
  });

  it("reflects whichever time zone is passed in", () => {
    const result = buildTimeContextPrompt("now", "iso", "UTC");
    expect(result).toContain("Current system time (UTC): now");
  });

  it("returns a trimmed string (no leading/trailing whitespace)", () => {
    const result = buildTimeContextPrompt("now", "iso", "UTC");
    expect(result).toBe(result.trim());
  });

  it("handles empty string inputs without throwing", () => {
    const result = buildTimeContextPrompt("", "", "UTC");
    expect(result).toContain("Current system time (UTC): ");
    expect(result).toContain("Current ISO time: ");
  });

  it("starts with the time-context header and includes the relative-time guidance line", () => {
    const result = buildTimeContextPrompt("now", "iso", "UTC");
    expect(result.startsWith("Time context:")).toBe(true);
    expect(result).toContain(
      'When answering relative-time questions such as "today", "yesterday", "tomorrow", "this week", or "recently", use the time given here',
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
