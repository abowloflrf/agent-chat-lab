import { describe, expect, it } from "vitest";
import {
  buildConversationTitlePrompt,
  TITLE_PROMPT_MAX_ASSISTANT_CHARS,
  TITLE_PROMPT_MAX_USER_CHARS,
} from "@/lib/persistence";

describe("buildConversationTitlePrompt", () => {
  it("asks for a plain-text title instead of JSON", () => {
    const { systemMessage, promptMessage } = buildConversationTitlePrompt({
      userContent: "帮我优化 generateConversationTitle 的 prompt",
      assistantContent: "可以，把 JSON 输出改成纯文本标题。",
    });

    expect(systemMessage).toContain("plain text");
    expect(systemMessage).toContain("Do not return JSON");
    expect(promptMessage).toContain("Output plain text only");
    expect(promptMessage).toContain("Aim for 4-8 words or 6-24 Chinese characters");
    expect(promptMessage).toContain(
      "Technical terms, framework names, and file/API names are allowed",
    );
  });

  it("includes the first assistant response when present", () => {
    const { promptMessage } = buildConversationTitlePrompt({
      userContent: "如何修复 Next.js route handler 鉴权",
      assistantContent: "需要检查 proxy.ts 和 API route 的认证逻辑。",
    });

    expect(promptMessage).toContain("First assistant response:");
    expect(promptMessage).toContain("需要检查 proxy.ts 和 API route 的认证逻辑。");
  });

  it("omits the assistant response section when it is empty", () => {
    const { promptMessage } = buildConversationTitlePrompt({
      userContent: "查询天气",
      assistantContent: "",
    });

    expect(promptMessage).not.toContain("First assistant response:");
  });

  it("truncates overlong user and assistant content", () => {
    const { promptMessage } = buildConversationTitlePrompt({
      userContent: `${"用".repeat(TITLE_PROMPT_MAX_USER_CHARS)}USER_TAIL`,
      assistantContent: `${"答".repeat(TITLE_PROMPT_MAX_ASSISTANT_CHARS)}ASSISTANT_TAIL`,
    });

    expect(promptMessage).toContain("...[truncated]");
    expect(promptMessage).not.toContain("USER_TAIL");
    expect(promptMessage).not.toContain("ASSISTANT_TAIL");
  });
});
