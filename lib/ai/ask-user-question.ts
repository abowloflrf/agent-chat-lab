import { z } from "zod";

export const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";
// 静态工具在 UIMessage 中的 part.type 固定为 `tool-${toolName}`。
export const ASK_USER_QUESTION_PART_TYPE = "tool-AskUserQuestion";

const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LABEL_LENGTH = 80;
const MAX_OPTION_DESCRIPTION_LENGTH = 200;
const MAX_OPTIONS_COUNT = 4;

export const askUserQuestionInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(MAX_QUESTION_LENGTH)
    .describe(
      "The question to show the user. Ask exactly one question at a time, phrased concisely, written in the user's conversation language.",
    ),
  options: z
    .array(
      z.object({
        label: z
          .string()
          .trim()
          .min(1)
          .max(MAX_OPTION_LABEL_LENGTH)
          .describe("Short option label rendered as a clickable button."),
        description: z
          .string()
          .trim()
          .max(MAX_OPTION_DESCRIPTION_LENGTH)
          .optional()
          .describe(
            "Optional. One short sentence explaining the impact or tradeoff of choosing this option.",
          ),
      }),
    )
    .max(MAX_OPTIONS_COUNT)
    .default([])
    .describe(
      'Optional. 2-4 mutually exclusive candidate choices. Only when you are reasonably confident in a recommendation, put it first and suffix its label with "(Recommended)"; for genuinely open choices where you have no clear basis to prefer one, mark none. Do not include catch-all options like "Other" or "Custom" — the UI automatically provides free-form input. Pass an empty array when the answer cannot be enumerated.',
    ),
  allowFreeText: z
    .boolean()
    .default(true)
    .describe("Whether the user may answer with free-form text. Defaults to true."),
});

export const askUserQuestionOutputSchema = z.object({
  outcome: z
    .enum(["selected_option", "free_text", "skipped", "unanswered"])
    .describe(
      "selected_option = the user picked one of the options; free_text = the user typed a custom answer; skipped = the user explicitly skipped the question; unanswered = the user ignored the question and sent a new message instead.",
    ),
  answer: z
    .string()
    .nullable()
    .describe(
      "The user's answer (option label or free-form text). Null when skipped/unanswered.",
    ),
  guidance: z.string().optional().describe("Disposition guidance for the assistant."),
});

export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;
export type AskUserQuestionOutput = z.infer<typeof askUserQuestionOutputSchema>;

export function buildSelectedOptionOutput(label: string): AskUserQuestionOutput {
  return { outcome: "selected_option", answer: label };
}

export function buildFreeTextOutput(text: string): AskUserQuestionOutput {
  return { outcome: "free_text", answer: text };
}

export function buildSkippedOutput(): AskUserQuestionOutput {
  return {
    outcome: "skipped",
    answer: null,
    guidance:
      "The user chose to skip this question. If you marked an option as recommended, proceed with it; otherwise make a reasonable assumption from the available context. State the choice or assumption you adopted in your reply, and do not ask this question again.",
  };
}

export function buildUnansweredOutput(): AskUserQuestionOutput {
  return {
    outcome: "unanswered",
    answer: null,
    guidance:
      "The user did not answer this question and sent a new message instead. Follow the user's latest message, and do not repeat the question.",
  };
}

export function parseAskUserQuestionInput(input: unknown): AskUserQuestionInput | null {
  const parsed = askUserQuestionInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseAskUserQuestionOutput(output: unknown): AskUserQuestionOutput | null {
  const parsed = askUserQuestionOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}
