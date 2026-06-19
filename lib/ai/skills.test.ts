import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The module captures process.env.SKILLS_DIR into a constant at import time, so each suite
// sets the env var first, then uses vi.resetModules() + dynamic import to get a fresh instance.
type SkillsModule = typeof import("@/lib/ai/skills");

/** Write a SKILL.md with the given frontmatter. */
async function writeSkill(
  dir: string,
  name: string,
  frontmatter: string,
): Promise<void> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), frontmatter, "utf8");
}

describe("isValidSkillName", () => {
  let mod: SkillsModule;

  beforeAll(async () => {
    vi.resetModules();
    mod = await import("@/lib/ai/skills");
  });

  it.each([
    "a",
    "abc",
    "a1",
    "foo-bar",
    "a--b", // consecutive hyphens are allowed in the middle
    "a-", // a trailing hyphen is allowed (only the FIRST char is restricted)
    "0",
    "9z-7",
    "x".repeat(64), // 1 + 63 = 64 chars, the max length
  ])("accepts valid name %j", (name) => {
    expect(mod.isValidSkillName(name)).toBe(true);
  });

  it.each([
    ["", "empty string"],
    ["../x", "path traversal"],
    ["Foo", "uppercase"],
    ["a/b", "contains slash"],
    ["a.b", "contains dot"],
    ["-leading", "leading hyphen"],
    ["1_2", "contains underscore"],
    [" a", "leading space"],
    ["a ", "trailing space"],
    ["x".repeat(65), "too long (65 chars)"],
  ])("rejects %j (%s)", (name) => {
    expect(mod.isValidSkillName(name)).toBe(false);
  });
});

describe("with a populated skills directory", () => {
  let tmp: string;
  let mod: SkillsModule;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "skills-"));

    // Valid skills, intentionally created out of alphabetical order.
    await writeSkill(
      tmp,
      "zebra",
      "---\nname: zebra\ndescription: stripes\n---\nbody-z\n",
    );
    await writeSkill(
      tmp,
      "alpha",
      '---\nname: alpha\ndescription: "first one"\n---\nbody-a\n',
    );
    await writeSkill(
      tmp,
      "beta",
      "---\nname: beta\ndescription: 'second one'\n---\nbody-b\n",
    );

    // Directory with no SKILL.md → skipped by discoverSkills.
    await mkdir(path.join(tmp, "nofile"), { recursive: true });

    // Invalid directory name → skipped by discoverSkills (and excluded from
    // getExistingSkillNames), even though it has a valid SKILL.md.
    await writeSkill(
      tmp,
      "Bad_Name",
      "---\nname: Bad_Name\ndescription: nope\n---\n",
    );

    // SKILL.md present but no description in frontmatter → skipped.
    await writeSkill(
      tmp,
      "nodesc",
      "---\nname: nodesc\n---\nbody-no-desc\n",
    );

    // SKILL.md whose description value is only whitespace → trimmed to "" →
    // falsy → skipped (distinct from a missing description key).
    await writeSkill(
      tmp,
      "blankdesc",
      "---\nname: blankdesc\ndescription:   \n---\nbody\n",
    );

    // SKILL.md with no leading frontmatter block at all → parser returns {} →
    // skipped (distinct from "frontmatter present but missing description").
    await writeSkill(
      tmp,
      "noheader",
      "no frontmatter here\ndescription: ignored because not in a block\n",
    );

    // Description longer than MAX_SKILL_DESCRIPTION_LENGTH (1024) → truncated.
    await writeSkill(
      tmp,
      "longdesc",
      `---\nname: longdesc\ndescription: ${"d".repeat(2000)}\n---\n`,
    );

    // Description with only a leading double-quote (not a matched pair) → the
    // quote is NOT stripped (strip requires both surrounding quotes).
    await writeSkill(
      tmp,
      "halfquote",
      '---\nname: halfquote\ndescription: "only-leading\n---\n',
    );

    process.env.SKILLS_DIR = tmp;
    vi.resetModules();
    mod = await import("@/lib/ai/skills");
  });

  afterAll(async () => {
    delete process.env.SKILLS_DIR;
    await rm(tmp, { recursive: true, force: true });
  });

  describe("getSkillsDir", () => {
    it("returns the configured directory", () => {
      expect(mod.getSkillsDir()).toBe(tmp);
    });
  });

  describe("discoverSkills", () => {
    it("returns only the valid skills sorted by name", async () => {
      const skills = await mod.discoverSkills();
      // Only the three name+description-clean skills survive AND have short
      // descriptions; halfquote/longdesc are valid too but asserted separately
      // (their descriptions are special). Here we pin the exact sort order of
      // the whole valid set by name.
      expect(skills.map((s) => s.name)).toEqual([
        "alpha",
        "beta",
        "halfquote",
        "longdesc",
        "zebra",
      ]);
    });

    it("descriptions of the simple skills are read verbatim", async () => {
      const skills = await mod.discoverSkills();
      const byName = new Map(skills.map((s) => [s.name, s.description]));
      expect(byName.get("alpha")).toBe("first one");
      expect(byName.get("beta")).toBe("second one");
      expect(byName.get("zebra")).toBe("stripes");
    });

    it("strips surrounding double and single quotes from the description", async () => {
      const skills = await mod.discoverSkills();
      const byName = new Map(skills.map((s) => [s.name, s.description]));
      // alpha used "..." and beta used '...'; both quotes are stripped.
      expect(byName.get("alpha")).toBe("first one");
      expect(byName.get("beta")).toBe("second one");
    });

    it("does NOT strip a single leading quote with no matching trailing quote", async () => {
      const skills = await mod.discoverSkills();
      const byName = new Map(skills.map((s) => [s.name, s.description]));
      // Stripping requires BOTH a leading and trailing quote of the same kind.
      expect(byName.get("halfquote")).toBe('"only-leading');
    });

    it("truncates a description to MAX_SKILL_DESCRIPTION_LENGTH (1024)", async () => {
      const skills = await mod.discoverSkills();
      const byName = new Map(skills.map((s) => [s.name, s.description]));
      const desc = byName.get("longdesc");
      expect(desc).toBeDefined();
      expect(desc?.length).toBe(1024);
      expect(desc).toBe("d".repeat(1024));
    });

    it("skips a SKILL.md whose description value is only whitespace", async () => {
      const skills = await mod.discoverSkills();
      expect(skills.some((s) => s.name === "blankdesc")).toBe(false);
    });

    it("skips a SKILL.md with no leading frontmatter block at all", async () => {
      const skills = await mod.discoverSkills();
      expect(skills.some((s) => s.name === "noheader")).toBe(false);
    });

    it("skips directories without a SKILL.md", async () => {
      const skills = await mod.discoverSkills();
      expect(skills.some((s) => s.name === "nofile")).toBe(false);
    });

    it("skips directories with an invalid name", async () => {
      const skills = await mod.discoverSkills();
      expect(skills.some((s) => s.name === "Bad_Name")).toBe(false);
    });

    it("skips skills whose frontmatter has no description", async () => {
      const skills = await mod.discoverSkills();
      expect(skills.some((s) => s.name === "nodesc")).toBe(false);
    });
  });

  describe("getExistingSkillNames", () => {
    it("returns a Set of valid directory names (excluding invalid names)", async () => {
      const names = await mod.getExistingSkillNames();
      expect(names).not.toBeNull();
      // Includes EVERY valid-named dir regardless of SKILL.md presence,
      // frontmatter validity, or description (it only checks the dir name
      // pattern). Excludes "Bad_Name" (invalid name).
      expect(names).toEqual(
        new Set([
          "alpha",
          "beta",
          "zebra",
          "nofile",
          "nodesc",
          "blankdesc",
          "noheader",
          "longdesc",
          "halfquote",
        ]),
      );
    });

    it("does not include directories with invalid names", async () => {
      const names = await mod.getExistingSkillNames();
      expect(names?.has("Bad_Name")).toBe(false);
    });
  });

  describe("loadSkill", () => {
    it("returns the name, full SKILL.md content, and an empty files list when there are no extra files", async () => {
      const loaded = await mod.loadSkill("alpha");
      expect(loaded).not.toBeNull();
      expect(loaded?.name).toBe("alpha");
      expect(loaded?.content).toContain("body-a");
      expect(loaded?.content).toContain("description:");
      expect(loaded?.files).toEqual([]);
    });

    it("trims the incoming name before lookup", async () => {
      const loaded = await mod.loadSkill("  alpha  ");
      expect(loaded?.name).toBe("alpha");
    });

    it("loads a skill that has no description (validity only gates discovery, not loading)", async () => {
      const loaded = await mod.loadSkill("nodesc");
      expect(loaded).not.toBeNull();
      expect(loaded?.content).toContain("body-no-desc");
    });

    it("lists extra files sorted, excludes SKILL.md, and suffixes directories with '/'", async () => {
      const extra = path.join(tmp, "withfiles");
      await mkdir(extra, { recursive: true });
      await writeFile(
        path.join(extra, "SKILL.md"),
        "---\nname: withfiles\ndescription: has files\n---\n",
        "utf8",
      );
      await writeFile(path.join(extra, "zzz.txt"), "z", "utf8");
      await writeFile(path.join(extra, "aaa.txt"), "a", "utf8");
      await mkdir(path.join(extra, "subdir"), { recursive: true });

      const loaded = await mod.loadSkill("withfiles");
      expect(loaded).not.toBeNull();
      expect(loaded?.files).toEqual([
        path.join(extra, "aaa.txt"),
        `${path.join(extra, "subdir")}/`,
        path.join(extra, "zzz.txt"),
      ]);
      // SKILL.md itself is never listed among files.
      expect(
        loaded?.files.some((f) => f.endsWith("SKILL.md")),
      ).toBe(false);
    });

    it("returns null when the (valid-named) directory exists but has no SKILL.md", async () => {
      // "nofile" is a real, validly-named directory but contains no SKILL.md,
      // so the readFile of SKILL.md throws and loadSkill returns null.
      expect(await mod.loadSkill("nofile")).toBeNull();
    });

    it("returns null for an invalid name", async () => {
      expect(await mod.loadSkill("Bad_Name")).toBeNull();
    });

    it("returns null for a path-traversal name", async () => {
      expect(await mod.loadSkill("../x")).toBeNull();
    });

    it("returns null for a missing skill", async () => {
      expect(await mod.loadSkill("doesnotexist")).toBeNull();
    });
  });
});

describe("with a non-existent skills directory", () => {
  let mod: SkillsModule;
  const missingDir = path.join(os.tmpdir(), "skills-missing-does-not-exist-xyz");

  beforeAll(async () => {
    process.env.SKILLS_DIR = missingDir;
    vi.resetModules();
    mod = await import("@/lib/ai/skills");
  });

  afterAll(() => {
    delete process.env.SKILLS_DIR;
  });

  it("getSkillsDir reflects the configured (missing) directory", () => {
    expect(mod.getSkillsDir()).toBe(missingDir);
  });

  it("discoverSkills returns an empty array when the directory does not exist", async () => {
    expect(await mod.discoverSkills()).toEqual([]);
  });

  it("getExistingSkillNames returns null when the directory does not exist", async () => {
    expect(await mod.getExistingSkillNames()).toBeNull();
  });

  it("loadSkill returns null when the directory does not exist", async () => {
    expect(await mod.loadSkill("anything")).toBeNull();
  });
});

describe("with SKILLS_DIR pointing at a non-directory (ENOTDIR)", () => {
  // Exercises the non-ENOENT branch of discoverSkills (logs a warning but still
  // returns []) and the catch branch of getExistingSkillNames (returns null),
  // distinct from the directory-does-not-exist (ENOENT) case above.
  let mod: SkillsModule;
  let filePath: string;

  beforeAll(async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "skills-file-"));
    filePath = path.join(tmp, "not-a-dir");
    await writeFile(filePath, "i am a file, not a directory", "utf8");
    process.env.SKILLS_DIR = filePath;
    vi.resetModules();
    mod = await import("@/lib/ai/skills");
  });

  afterAll(async () => {
    delete process.env.SKILLS_DIR;
    await rm(path.dirname(filePath), { recursive: true, force: true });
  });

  it("discoverSkills returns an empty array", async () => {
    expect(await mod.discoverSkills()).toEqual([]);
  });

  it("getExistingSkillNames returns null", async () => {
    expect(await mod.getExistingSkillNames()).toBeNull();
  });

  it("loadSkill returns null", async () => {
    expect(await mod.loadSkill("anything")).toBeNull();
  });
});

describe("getSkillsDir env-var handling", () => {
  it("trims surrounding whitespace from SKILLS_DIR", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "skills-trim-"));
    try {
      process.env.SKILLS_DIR = `  ${tmp}  `;
      vi.resetModules();
      const mod: SkillsModule = await import("@/lib/ai/skills");
      expect(mod.getSkillsDir()).toBe(tmp);
    } finally {
      delete process.env.SKILLS_DIR;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to <cwd>/workspace/skills when SKILLS_DIR is whitespace-only", async () => {
    process.env.SKILLS_DIR = "   ";
    try {
      vi.resetModules();
      const mod: SkillsModule = await import("@/lib/ai/skills");
      expect(mod.getSkillsDir()).toBe(
        path.join(process.cwd(), "workspace", "skills"),
      );
    } finally {
      delete process.env.SKILLS_DIR;
    }
  });

  it("falls back to <cwd>/workspace/skills when SKILLS_DIR is unset", async () => {
    delete process.env.SKILLS_DIR;
    vi.resetModules();
    const mod: SkillsModule = await import("@/lib/ai/skills");
    expect(mod.getSkillsDir()).toBe(
      path.join(process.cwd(), "workspace", "skills"),
    );
  });
});
