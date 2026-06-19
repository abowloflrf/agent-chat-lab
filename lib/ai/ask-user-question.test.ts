import { describe, it, expect } from "vitest";
import {
  parseAskUserQuestionInput,
  parseAskUserQuestionOutput,
  buildSelectedOptionOutput,
  buildFreeTextOutput,
  buildSkippedOutput,
  buildUnansweredOutput,
  ASK_USER_QUESTION_TOOL_NAME,
  ASK_USER_QUESTION_PART_TYPE,
  type AskUserQuestionOutput,
} from "@/lib/ai/ask-user-question";

describe("constants", () => {
  it("exposes the tool name and the derived part type", () => {
    expect(ASK_USER_QUESTION_TOOL_NAME).toBe("AskUserQuestion");
    expect(ASK_USER_QUESTION_PART_TYPE).toBe(
      `tool-${ASK_USER_QUESTION_TOOL_NAME}`,
    );
  });
});

describe("parseAskUserQuestionInput — valid input & defaults", () => {
  it("parses a minimal question and applies defaults", () => {
    const result = parseAskUserQuestionInput({ question: "Pick one?" });
    expect(result).not.toBeNull();
    expect(result).toEqual({
      question: "Pick one?",
      options: [],
      allowFreeText: true,
    });
  });

  it("trims surrounding whitespace from the question", () => {
    const result = parseAskUserQuestionInput({ question: "   Hello?   " });
    expect(result?.question).toBe("Hello?");
  });

  it("respects an explicit allowFreeText: false", () => {
    const result = parseAskUserQuestionInput({
      question: "Yes or no?",
      allowFreeText: false,
    });
    expect(result?.allowFreeText).toBe(false);
  });

  it("parses options with labels and optional descriptions", () => {
    const result = parseAskUserQuestionInput({
      question: "Which framework?",
      options: [
        { label: "Next.js", description: "App Router" },
        { label: "Remix" },
      ],
    });
    expect(result?.options).toEqual([
      { label: "Next.js", description: "App Router" },
      { label: "Remix" },
    ]);
  });

  it("trims option labels and descriptions", () => {
    const result = parseAskUserQuestionInput({
      question: "Choose?",
      options: [{ label: "  A  ", description: "  desc  " }],
    });
    expect(result?.options).toEqual([{ label: "A", description: "desc" }]);
  });

  it("accepts exactly the max of 4 options", () => {
    const result = parseAskUserQuestionInput({
      question: "Pick?",
      options: [
        { label: "1" },
        { label: "2" },
        { label: "3" },
        { label: "4" },
      ],
    });
    expect(result?.options).toHaveLength(4);
  });

  it("accepts a question of exactly 500 characters", () => {
    const question = "a".repeat(500);
    const result = parseAskUserQuestionInput({ question });
    expect(result?.question).toBe(question);
  });

  it("trims before enforcing max length (504 chars trimming to 500 is accepted)", () => {
    // .trim() runs in the pipeline before .max(500): the surrounding spaces are
    // removed first, leaving exactly 500 chars, which passes.
    const padded = `  ${"a".repeat(500)}  `;
    const result = parseAskUserQuestionInput({ question: padded });
    expect(result?.question).toBe("a".repeat(500));
    expect(result?.question.length).toBe(500);
  });

  it("trims newlines/tabs around the question", () => {
    const result = parseAskUserQuestionInput({ question: "\n\tHi?\n" });
    expect(result?.question).toBe("Hi?");
  });

  it("accepts an explicit empty options array", () => {
    const result = parseAskUserQuestionInput({ question: "Q", options: [] });
    expect(result).toEqual({ question: "Q", options: [], allowFreeText: true });
  });

  it("accepts an option label of exactly 80 characters", () => {
    const label = "a".repeat(80);
    const result = parseAskUserQuestionInput({
      question: "Q",
      options: [{ label }],
    });
    expect(result?.options).toEqual([{ label }]);
  });

  it("accepts an option description of exactly 200 characters", () => {
    const description = "d".repeat(200);
    const result = parseAskUserQuestionInput({
      question: "Q",
      options: [{ label: "A", description }],
    });
    expect(result?.options).toEqual([{ label: "A", description }]);
  });

  it("accepts a whitespace-only description, trimming it to an empty string", () => {
    // description has .trim().max(200) but no .min(1), so "   " trims to "".
    const result = parseAskUserQuestionInput({
      question: "Q",
      options: [{ label: "A", description: "   " }],
    });
    expect(result?.options).toEqual([{ label: "A", description: "" }]);
  });

  it("strips unknown keys instead of rejecting them (zod strips by default)", () => {
    const result = parseAskUserQuestionInput({ question: "Q", bogus: 1 });
    expect(result).toEqual({ question: "Q", options: [], allowFreeText: true });
    expect(result).not.toHaveProperty("bogus");
  });

  // KNOWN GAP: the prose describes options as "2-4 mutually exclusive choices",
  // but the schema only enforces `.max(4)` with no minimum, so a single option
  // (and an empty array) parse successfully. Pinning the actual lenient behavior.
  it("accepts a single option even though the docs suggest a minimum of 2", () => {
    const result = parseAskUserQuestionInput({
      question: "Q",
      options: [{ label: "Only one" }],
    });
    expect(result?.options).toEqual([{ label: "Only one" }]);
  });
});

describe("parseAskUserQuestionInput — invalid input returns null", () => {
  it("returns null when question is missing", () => {
    expect(parseAskUserQuestionInput({})).toBeNull();
  });

  it("returns null when question is an empty string", () => {
    expect(parseAskUserQuestionInput({ question: "" })).toBeNull();
  });

  it("returns null when question is only whitespace (trimmed to empty)", () => {
    expect(parseAskUserQuestionInput({ question: "    " })).toBeNull();
  });

  it("returns null when question exceeds 500 characters", () => {
    expect(
      parseAskUserQuestionInput({ question: "a".repeat(501) }),
    ).toBeNull();
  });

  it("returns null when options length exceeds 4", () => {
    expect(
      parseAskUserQuestionInput({
        question: "Pick?",
        options: [
          { label: "1" },
          { label: "2" },
          { label: "3" },
          { label: "4" },
          { label: "5" },
        ],
      }),
    ).toBeNull();
  });

  it("returns null when an option label is empty", () => {
    expect(
      parseAskUserQuestionInput({
        question: "Pick?",
        options: [{ label: "" }],
      }),
    ).toBeNull();
  });

  it("returns null when an option label exceeds 80 characters", () => {
    expect(
      parseAskUserQuestionInput({
        question: "Pick?",
        options: [{ label: "a".repeat(81) }],
      }),
    ).toBeNull();
  });

  it("returns null when an option description exceeds 200 characters", () => {
    expect(
      parseAskUserQuestionInput({
        question: "Pick?",
        options: [{ label: "A", description: "d".repeat(201) }],
      }),
    ).toBeNull();
  });

  it("returns null when allowFreeText is not a boolean", () => {
    expect(
      parseAskUserQuestionInput({ question: "Q?", allowFreeText: "yes" }),
    ).toBeNull();
  });

  it("returns null when an option is missing its required label", () => {
    expect(
      parseAskUserQuestionInput({
        question: "Q",
        options: [{ description: "no label here" }],
      }),
    ).toBeNull();
  });

  it("returns null when an option label is only whitespace (trimmed to empty)", () => {
    expect(
      parseAskUserQuestionInput({
        question: "Q",
        options: [{ label: "   " }],
      }),
    ).toBeNull();
  });

  it("returns null when options is not an array", () => {
    expect(
      parseAskUserQuestionInput({ question: "Q", options: "nope" }),
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseAskUserQuestionInput(null)).toBeNull();
    expect(parseAskUserQuestionInput("question")).toBeNull();
    expect(parseAskUserQuestionInput(42)).toBeNull();
  });
});

describe("parseAskUserQuestionOutput — valid outcomes", () => {
  it.each([
    ["selected_option", "My pick"],
    ["free_text", "typed answer"],
  ] as const)("parses outcome %s with a string answer", (outcome, answer) => {
    const result = parseAskUserQuestionOutput({ outcome, answer });
    expect(result).toEqual({ outcome, answer });
  });

  it.each(["skipped", "unanswered"] as const)(
    "parses outcome %s with a null answer",
    (outcome) => {
      const result = parseAskUserQuestionOutput({ outcome, answer: null });
      expect(result).toEqual({ outcome, answer: null });
    },
  );

  it("preserves an optional guidance field", () => {
    const result = parseAskUserQuestionOutput({
      outcome: "skipped",
      answer: null,
      guidance: "do the thing",
    });
    expect(result?.guidance).toBe("do the thing");
  });

  it("parses without a guidance field (optional)", () => {
    const result = parseAskUserQuestionOutput({
      outcome: "free_text",
      answer: "x",
    });
    expect(result).toEqual({ outcome: "free_text", answer: "x" });
    expect(result?.guidance).toBeUndefined();
  });

  it("strips unknown keys from the output", () => {
    const result = parseAskUserQuestionOutput({
      outcome: "free_text",
      answer: "x",
      bogus: 1,
    });
    expect(result).toEqual({ outcome: "free_text", answer: "x" });
    expect(result).not.toHaveProperty("bogus");
  });

  // KNOWN GAP: the schema does not couple `outcome` to `answer`; it only checks
  // the enum and that answer is a (nullable) string. So the following
  // "inconsistent" shapes — which the prose says should not occur — still parse.
  it("does NOT enforce that skipped/unanswered carry a null answer", () => {
    expect(
      parseAskUserQuestionOutput({ outcome: "skipped", answer: "oops" }),
    ).toEqual({ outcome: "skipped", answer: "oops" });
    expect(
      parseAskUserQuestionOutput({ outcome: "unanswered", answer: "still here" }),
    ).toEqual({ outcome: "unanswered", answer: "still here" });
  });

  it("does NOT enforce that selected_option/free_text carry a non-null answer", () => {
    expect(
      parseAskUserQuestionOutput({ outcome: "selected_option", answer: null }),
    ).toEqual({ outcome: "selected_option", answer: null });
    expect(
      parseAskUserQuestionOutput({ outcome: "free_text", answer: null }),
    ).toEqual({ outcome: "free_text", answer: null });
  });
});

describe("parseAskUserQuestionOutput — invalid output returns null", () => {
  it("returns null for an unknown outcome", () => {
    expect(
      parseAskUserQuestionOutput({ outcome: "maybe", answer: "x" }),
    ).toBeNull();
  });

  it("returns null when outcome is missing", () => {
    expect(parseAskUserQuestionOutput({ answer: "x" })).toBeNull();
  });

  it("returns null when answer is missing (required, nullable)", () => {
    expect(
      parseAskUserQuestionOutput({ outcome: "selected_option" }),
    ).toBeNull();
  });

  it("returns null when answer is the wrong type", () => {
    expect(
      parseAskUserQuestionOutput({ outcome: "free_text", answer: 123 }),
    ).toBeNull();
  });

  it("returns null when guidance is present but not a string", () => {
    expect(
      parseAskUserQuestionOutput({
        outcome: "skipped",
        answer: null,
        guidance: 5,
      }),
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseAskUserQuestionOutput(null)).toBeNull();
    expect(parseAskUserQuestionOutput("free_text")).toBeNull();
    expect(parseAskUserQuestionOutput(42)).toBeNull();
    expect(parseAskUserQuestionOutput(undefined)).toBeNull();
  });
});

describe("output builders", () => {
  it("buildSelectedOptionOutput returns a selected_option carrying the label", () => {
    expect(buildSelectedOptionOutput("Option A")).toEqual({
      outcome: "selected_option",
      answer: "Option A",
    });
  });

  it("buildSelectedOptionOutput passes through an empty label verbatim", () => {
    expect(buildSelectedOptionOutput("")).toEqual({
      outcome: "selected_option",
      answer: "",
    });
  });

  it("buildFreeTextOutput returns a free_text carrying the text", () => {
    expect(buildFreeTextOutput("hello there")).toEqual({
      outcome: "free_text",
      answer: "hello there",
    });
  });

  it("buildFreeTextOutput passes through an empty string verbatim", () => {
    expect(buildFreeTextOutput("")).toEqual({
      outcome: "free_text",
      answer: "",
    });
  });

  it("selected_option / free_text builders omit guidance entirely", () => {
    expect(buildSelectedOptionOutput("x").guidance).toBeUndefined();
    expect(buildFreeTextOutput("y").guidance).toBeUndefined();
    expect(buildSelectedOptionOutput("x")).not.toHaveProperty("guidance");
    expect(buildFreeTextOutput("y")).not.toHaveProperty("guidance");
  });

  it("buildSkippedOutput returns skipped with null answer and non-empty guidance", () => {
    const result = buildSkippedOutput();
    expect(result.outcome).toBe("skipped");
    expect(result.answer).toBeNull();
    expect(result.guidance).toBeTruthy();
    expect((result.guidance ?? "").length).toBeGreaterThan(0);
  });

  it("buildUnansweredOutput returns unanswered with null answer and non-empty guidance", () => {
    const result = buildUnansweredOutput();
    expect(result.outcome).toBe("unanswered");
    expect(result.answer).toBeNull();
    expect(result.guidance).toBeTruthy();
    expect((result.guidance ?? "").length).toBeGreaterThan(0);
  });

  it("skipped and unanswered carry distinct guidance strings", () => {
    const skipped = buildSkippedOutput();
    const unanswered = buildUnansweredOutput();
    expect(typeof skipped.guidance).toBe("string");
    expect(typeof unanswered.guidance).toBe("string");
    expect(skipped.guidance).not.toBe(unanswered.guidance);
  });

  it.each([
    buildSelectedOptionOutput("label"),
    buildFreeTextOutput("text"),
    buildSkippedOutput(),
    buildUnansweredOutput(),
  ] satisfies AskUserQuestionOutput[])(
    "builder output round-trips through parseAskUserQuestionOutput",
    (built) => {
      expect(parseAskUserQuestionOutput(built)).toEqual(built);
    },
  );
});
