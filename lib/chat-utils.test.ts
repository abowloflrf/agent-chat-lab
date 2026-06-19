import { describe, it, expect } from "vitest";
import {
  resolveModelSelection,
  reconcileToolSelection,
  formatShortConversationId,
  hostFromUrl,
  extractMessageText,
  hasUnresolvedInterruption,
  findLastUserMessageIndex,
  findUserIndexBefore,
  findLastUserMessageText,
} from "@/lib/chat-utils";
import type { ChatUIMessage, ChatMessageMetadata } from "@/lib/observability";
import type { ProviderSettings, ProviderModel } from "@/lib/provider-config";
import type { SessionToolItem } from "@/components/session-tool-selector";
import type { ConversationSessionConfig } from "@/lib/persistence";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeModel(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: "model-row-1",
    modelId: "gpt-4o",
    isEnabled: true,
    isDefault: false,
    ...overrides,
  } satisfies ProviderModel;
}

function makeProvider(
  overrides: Partial<ProviderSettings> = {},
): ProviderSettings {
  return {
    id: "provider-1",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    protocol: "chat-completion",
    isEnabled: true,
    isDefault: false,
    models: [makeModel()],
    ...overrides,
  } satisfies ProviderSettings;
}

function makeConfig(
  overrides: Partial<ConversationSessionConfig> = {},
): ConversationSessionConfig {
  return {
    modelProviderId: null,
    modelId: null,
    enabledMcpServerIds: null,
    enabledSkillNames: null,
    ...overrides,
  } satisfies ConversationSessionConfig;
}

function makeMessage(
  role: ChatUIMessage["role"],
  parts: ChatUIMessage["parts"],
  metadata?: ChatMessageMetadata,
): ChatUIMessage {
  return {
    id: `msg-${role}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    parts,
    ...(metadata ? { metadata } : {}),
  } satisfies ChatUIMessage;
}

function textPart(text: string): ChatUIMessage["parts"][number] {
  return { type: "text", text } satisfies Extract<
    ChatUIMessage["parts"][number],
    { type: "text" }
  >;
}

function reasoningPart(text: string): ChatUIMessage["parts"][number] {
  return { type: "reasoning", text } satisfies Extract<
    ChatUIMessage["parts"][number],
    { type: "reasoning" }
  >;
}

// ---------------------------------------------------------------------------
// resolveModelSelection
// ---------------------------------------------------------------------------

describe("resolveModelSelection — saved selection honored", () => {
  it("returns the saved provider+model when both exist and are enabled", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "Provider One",
        isDefault: true,
        models: [makeModel({ id: "m1", modelId: "alpha", isDefault: true })],
      }),
      makeProvider({
        id: "p2",
        name: "Provider Two",
        models: [makeModel({ id: "m2", modelId: "beta" })],
      }),
    ];
    const config = makeConfig({ modelProviderId: "p2", modelId: "beta" });

    expect(resolveModelSelection(providers, config)).toEqual({
      providerId: "p2",
      providerName: "Provider Two",
      modelId: "beta",
    });
  });

  it("matches the saved model by modelId, not by row id", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "P1",
        isDefault: true,
        // The row id ("row-x") differs from the modelId ("gpt-x"); the saved
        // config keys on modelId, so resolution must match on modelId.
        models: [makeModel({ id: "row-x", modelId: "gpt-x" })],
      }),
    ];
    const config = makeConfig({ modelProviderId: "p1", modelId: "gpt-x" });

    expect(resolveModelSelection(providers, config)).toEqual({
      providerId: "p1",
      providerName: "P1",
      modelId: "gpt-x",
    });
  });
});

describe("resolveModelSelection — fallback to defaults", () => {
  it("falls back when saved provider is disabled", () => {
    const providers = [
      makeProvider({
        id: "saved",
        name: "Saved (disabled)",
        isEnabled: false,
        models: [makeModel({ id: "ms", modelId: "saved-model" })],
      }),
      makeProvider({
        id: "def",
        name: "Default",
        isDefault: true,
        models: [makeModel({ id: "md", modelId: "default-model", isDefault: true })],
      }),
    ];
    const config = makeConfig({
      modelProviderId: "saved",
      modelId: "saved-model",
    });

    expect(resolveModelSelection(providers, config)).toEqual({
      providerId: "def",
      providerName: "Default",
      modelId: "default-model",
    });
  });

  it("falls back when the saved model is disabled within an enabled provider", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "P1",
        isDefault: true,
        models: [
          makeModel({ id: "m-disabled", modelId: "old", isEnabled: false }),
          makeModel({ id: "m-enabled", modelId: "new", isDefault: true }),
        ],
      }),
    ];
    const config = makeConfig({ modelProviderId: "p1", modelId: "old" });

    expect(resolveModelSelection(providers, config)).toEqual({
      providerId: "p1",
      providerName: "P1",
      modelId: "new",
    });
  });

  it("falls back when the saved model no longer exists", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "P1",
        isDefault: true,
        models: [makeModel({ id: "m1", modelId: "still-here", isDefault: true })],
      }),
    ];
    const config = makeConfig({ modelProviderId: "p1", modelId: "gone" });

    expect(resolveModelSelection(providers, config)).toEqual({
      providerId: "p1",
      providerName: "P1",
      modelId: "still-here",
    });
  });

  it("falls back to the DEFAULT provider (not the saved one) when the saved model is gone", () => {
    // The saved provider is enabled but its saved model vanished. The fallback
    // recomputes the default provider independently, so resolution jumps to the
    // OTHER (default) provider rather than staying on the saved provider.
    const providers = [
      makeProvider({
        id: "saved",
        name: "Saved (enabled, not default)",
        isDefault: false,
        models: [
          makeModel({ id: "ms", modelId: "saved-still-here", isDefault: true }),
        ],
      }),
      makeProvider({
        id: "def",
        name: "Default",
        isDefault: true,
        models: [
          makeModel({ id: "md", modelId: "default-model", isDefault: true }),
        ],
      }),
    ];
    const config = makeConfig({ modelProviderId: "saved", modelId: "gone" });

    expect(resolveModelSelection(providers, config)).toEqual({
      providerId: "def",
      providerName: "Default",
      modelId: "default-model",
    });
  });

  it("falls back when config has no saved selection (nulls)", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "P1",
        isDefault: true,
        models: [makeModel({ id: "m1", modelId: "the-model", isDefault: true })],
      }),
    ];

    expect(resolveModelSelection(providers, makeConfig())).toEqual({
      providerId: "p1",
      providerName: "P1",
      modelId: "the-model",
    });
  });

  it("prefers the enabled+isDefault provider over an earlier enabled one", () => {
    const providers = [
      makeProvider({
        id: "first",
        name: "First (not default)",
        isDefault: false,
        models: [makeModel({ id: "mf", modelId: "first-model" })],
      }),
      makeProvider({
        id: "second",
        name: "Second (default)",
        isDefault: true,
        models: [makeModel({ id: "ms", modelId: "second-model" })],
      }),
    ];

    expect(resolveModelSelection(providers, makeConfig())).toEqual({
      providerId: "second",
      providerName: "Second (default)",
      modelId: "second-model",
    });
  });

  it("uses the first enabled provider when none is marked default", () => {
    const providers = [
      makeProvider({
        id: "disabled",
        name: "Disabled",
        isEnabled: false,
        models: [makeModel({ id: "md", modelId: "x" })],
      }),
      makeProvider({
        id: "firstEnabled",
        name: "First Enabled",
        isDefault: false,
        models: [makeModel({ id: "m1", modelId: "first-enabled-model" })],
      }),
      makeProvider({
        id: "alsoEnabled",
        name: "Also Enabled",
        isDefault: false,
        models: [makeModel({ id: "m2", modelId: "another" })],
      }),
    ];

    expect(resolveModelSelection(providers, makeConfig())).toEqual({
      providerId: "firstEnabled",
      providerName: "First Enabled",
      modelId: "first-enabled-model",
    });
  });

  it("prefers the enabled+isDefault model over an earlier enabled one", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "P1",
        isDefault: true,
        models: [
          makeModel({ id: "m-first", modelId: "first", isDefault: false }),
          makeModel({ id: "m-default", modelId: "default-pick", isDefault: true }),
        ],
      }),
    ];

    expect(resolveModelSelection(providers, makeConfig())?.modelId).toBe(
      "default-pick",
    );
  });

  it("uses the first enabled model when none is marked default", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "P1",
        isDefault: true,
        models: [
          makeModel({ id: "m-off", modelId: "off", isEnabled: false }),
          makeModel({ id: "m-first-on", modelId: "first-on", isDefault: false }),
          makeModel({ id: "m-second-on", modelId: "second-on", isDefault: false }),
        ],
      }),
    ];

    expect(resolveModelSelection(providers, makeConfig())?.modelId).toBe(
      "first-on",
    );
  });
});

describe("resolveModelSelection — null results", () => {
  it("returns null when there are no providers at all", () => {
    expect(resolveModelSelection([], makeConfig())).toBeNull();
  });

  it("returns null when no provider is enabled", () => {
    const providers = [
      makeProvider({ id: "p1", isEnabled: false }),
      makeProvider({ id: "p2", isEnabled: false }),
    ];
    expect(resolveModelSelection(providers, makeConfig())).toBeNull();
  });

  it("returns null when the chosen provider has no enabled model", () => {
    const providers = [
      makeProvider({
        id: "p1",
        isDefault: true,
        models: [
          makeModel({ id: "m1", modelId: "a", isEnabled: false }),
          makeModel({ id: "m2", modelId: "b", isEnabled: false }),
        ],
      }),
    ];
    expect(resolveModelSelection(providers, makeConfig())).toBeNull();
  });

  it("returns null when the chosen provider has no models", () => {
    const providers = [makeProvider({ id: "p1", isDefault: true, models: [] })];
    expect(resolveModelSelection(providers, makeConfig())).toBeNull();
  });

  it("does NOT skip to another enabled provider when the default's models are all disabled", () => {
    // The default provider is selected first; if it has no enabled model the
    // function returns null rather than continuing to the next provider.
    const providers = [
      makeProvider({
        id: "default",
        isDefault: true,
        models: [makeModel({ id: "m1", modelId: "a", isEnabled: false })],
      }),
      makeProvider({
        id: "other",
        isDefault: false,
        models: [makeModel({ id: "m2", modelId: "b" })],
      }),
    ];
    expect(resolveModelSelection(providers, makeConfig())).toBeNull();
  });

  it("ignores a saved selection that is only partially set (provider without model)", () => {
    const providers = [
      makeProvider({
        id: "p1",
        name: "P1",
        isDefault: true,
        models: [makeModel({ id: "m1", modelId: "fallback", isDefault: true })],
      }),
    ];
    // Only modelProviderId set, modelId null → the saved branch is skipped and
    // we go straight to defaults.
    const config = makeConfig({ modelProviderId: "p1", modelId: null });

    expect(resolveModelSelection(providers, config)?.modelId).toBe("fallback");
  });
});

// ---------------------------------------------------------------------------
// reconcileToolSelection
// ---------------------------------------------------------------------------

describe("reconcileToolSelection", () => {
  const items = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ] satisfies SessionToolItem[];

  it("returns all item ids when saved is null (not narrowed yet)", () => {
    expect(reconcileToolSelection(null, items)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array when saved is null and there are no items", () => {
    expect(reconcileToolSelection(null, [])).toEqual([]);
  });

  it("intersects the saved list with the current candidates", () => {
    expect(reconcileToolSelection(["a", "c"], items)).toEqual(["a", "c"]);
  });

  it("drops saved ids that are no longer candidates", () => {
    expect(reconcileToolSelection(["a", "gone", "c"], items)).toEqual([
      "a",
      "c",
    ]);
  });

  it("preserves the order of the saved list, not the items list", () => {
    expect(reconcileToolSelection(["c", "a"], items)).toEqual(["c", "a"]);
  });

  it("keeps duplicate saved ids if they are valid candidates", () => {
    // filter does not dedupe; both copies survive because "a" is a candidate.
    expect(reconcileToolSelection(["a", "a"], items)).toEqual(["a", "a"]);
  });

  it("returns an empty array when an empty saved list is given", () => {
    expect(reconcileToolSelection([], items)).toEqual([]);
  });

  it("returns an empty array when none of the saved ids are candidates", () => {
    expect(reconcileToolSelection(["x", "y"], items)).toEqual([]);
  });

  it("returns a fresh array, not the saved reference (filter copies)", () => {
    const saved = ["a", "b"];
    const result = reconcileToolSelection(saved, items);
    expect(result).not.toBe(saved);
    expect(result).toEqual(["a", "b"]);
  });

  it("matches candidates by exact id (no substring/normalization)", () => {
    // "A" (uppercase) and "ab" must NOT match candidate "a"/"b".
    expect(reconcileToolSelection(["A", "ab", "a"], items)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// formatShortConversationId
// ---------------------------------------------------------------------------

describe("formatShortConversationId", () => {
  it("returns the first 8 characters", () => {
    expect(formatShortConversationId("0123456789abcdef")).toBe("01234567");
  });

  it("returns the whole string when shorter than 8 chars", () => {
    expect(formatShortConversationId("abc")).toBe("abc");
  });

  it("returns an empty string for an empty id", () => {
    expect(formatShortConversationId("")).toBe("");
  });

  it("returns exactly 8 chars for an 8-char id", () => {
    expect(formatShortConversationId("abcdefgh")).toBe("abcdefgh");
  });
});

// ---------------------------------------------------------------------------
// hostFromUrl
// ---------------------------------------------------------------------------

describe("hostFromUrl", () => {
  it("returns the host for a valid http url", () => {
    expect(hostFromUrl("https://example.com/mcp")).toBe("example.com");
  });

  it("includes a non-default port in the host", () => {
    expect(hostFromUrl("http://localhost:8080/sse")).toBe("localhost:8080");
  });

  it("falls back to the original string for an invalid url", () => {
    expect(hostFromUrl("not a url")).toBe("not a url");
  });

  it("falls back to the original string for an empty input", () => {
    expect(hostFromUrl("")).toBe("");
  });

  it("returns the host (no userinfo) when credentials are embedded", () => {
    expect(hostFromUrl("https://user:pass@host.dev:9000/path")).toBe(
      "host.dev:9000",
    );
  });
});

// ---------------------------------------------------------------------------
// extractMessageText
// ---------------------------------------------------------------------------

describe("extractMessageText", () => {
  it("joins multiple text parts with newlines", () => {
    const message = makeMessage("assistant", [
      textPart("hello"),
      textPart("world"),
    ]);
    expect(extractMessageText(message)).toBe("hello\nworld");
  });

  it("ignores non-text parts", () => {
    const message = makeMessage("assistant", [
      reasoningPart("thinking..."),
      textPart("answer"),
    ]);
    expect(extractMessageText(message)).toBe("answer");
  });

  it("trims surrounding whitespace of the joined result", () => {
    const message = makeMessage("user", [textPart("  spaced  ")]);
    expect(extractMessageText(message)).toBe("spaced");
  });

  it("returns an empty string when there are no text parts", () => {
    const message = makeMessage("assistant", [reasoningPart("only thinking")]);
    expect(extractMessageText(message)).toBe("");
  });

  it("returns an empty string for a message with no parts", () => {
    const message = makeMessage("user", []);
    expect(extractMessageText(message)).toBe("");
  });

  it("trims the joined string but keeps interior newlines from joining", () => {
    // The trim is applied to the whole joined string, so an empty-string part
    // between two real ones still contributes a newline in the middle.
    const message = makeMessage("assistant", [
      textPart("a"),
      textPart(""),
      textPart("b"),
    ]);
    expect(extractMessageText(message)).toBe("a\n\nb");
  });
});

// ---------------------------------------------------------------------------
// hasUnresolvedInterruption
// ---------------------------------------------------------------------------

describe("hasUnresolvedInterruption", () => {
  it("returns false for an empty history", () => {
    expect(hasUnresolvedInterruption([])).toBe(false);
  });

  it("returns true when the last message is marked interrupted", () => {
    const messages = [
      makeMessage("user", [textPart("hi")]),
      makeMessage("assistant", [textPart("partial")], { interrupted: true }),
    ];
    expect(hasUnresolvedInterruption(messages)).toBe(true);
  });

  it("returns false when the last message is not interrupted", () => {
    const messages = [
      makeMessage("user", [textPart("hi")]),
      makeMessage("assistant", [textPart("done")], { interrupted: false }),
    ];
    expect(hasUnresolvedInterruption(messages)).toBe(false);
  });

  it("only looks at the LAST message, ignoring an earlier interruption", () => {
    const messages = [
      makeMessage("assistant", [textPart("old")], { interrupted: true }),
      makeMessage("user", [textPart("continue")]),
      makeMessage("assistant", [textPart("fresh")], { interrupted: false }),
    ];
    expect(hasUnresolvedInterruption(messages)).toBe(false);
  });

  it("returns false when the last message has no metadata", () => {
    const messages = [
      makeMessage("assistant", [textPart("old")], { interrupted: true }),
      makeMessage("user", [textPart("no metadata here")]),
    ];
    expect(hasUnresolvedInterruption(messages)).toBe(false);
  });

  it("returns false when interrupted is explicitly undefined on the last message", () => {
    // isInterruptedMessage checks strict === true; an explicit undefined
    // (e.g. metadata with other fields but no interrupted flag) is not "true".
    const messages = [
      makeMessage("assistant", [textPart("done")], { interrupted: undefined }),
    ];
    expect(hasUnresolvedInterruption(messages)).toBe(false);
  });

  // KNOWN GAP: hasUnresolvedInterruption only inspects metadata.interrupted on
  // the LAST message and does NOT gate on role. Despite the docstring framing
  // it around "assistant" turns, a USER message carrying interrupted:true is
  // still reported as an unresolved interruption. Pins the actual behavior.
  it("reports interruption even when the last message is a user message", () => {
    const messages = [
      makeMessage("user", [textPart("user turn")], { interrupted: true }),
    ];
    expect(hasUnresolvedInterruption(messages)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findLastUserMessageIndex
// ---------------------------------------------------------------------------

describe("findLastUserMessageIndex", () => {
  it("returns -1 for an empty array", () => {
    expect(findLastUserMessageIndex([])).toBe(-1);
  });

  it("returns -1 when there is no user message", () => {
    const messages = [
      makeMessage("assistant", [textPart("a")]),
      makeMessage("assistant", [textPart("b")]),
    ];
    expect(findLastUserMessageIndex(messages)).toBe(-1);
  });

  it("returns the index of the only user message", () => {
    const messages = [
      makeMessage("assistant", [textPart("a")]),
      makeMessage("user", [textPart("q")]),
      makeMessage("assistant", [textPart("b")]),
    ];
    expect(findLastUserMessageIndex(messages)).toBe(1);
  });

  it("returns the last user index when there are several", () => {
    const messages = [
      makeMessage("user", [textPart("q1")]),
      makeMessage("assistant", [textPart("a1")]),
      makeMessage("user", [textPart("q2")]),
      makeMessage("assistant", [textPart("a2")]),
    ];
    expect(findLastUserMessageIndex(messages)).toBe(2);
  });

  it("returns the final index when the last message itself is a user message", () => {
    const messages = [
      makeMessage("assistant", [textPart("a")]),
      makeMessage("user", [textPart("q")]),
    ];
    expect(findLastUserMessageIndex(messages)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findUserIndexBefore
// ---------------------------------------------------------------------------

describe("findUserIndexBefore", () => {
  const messages = [
    makeMessage("user", [textPart("q1")]), // 0
    makeMessage("assistant", [textPart("a1")]), // 1
    makeMessage("user", [textPart("q2")]), // 2
    makeMessage("assistant", [textPart("a2")]), // 3
  ];

  it("finds the user message strictly before the endExclusive bound", () => {
    // Looking before index 3 (the assistant a2) finds the user at index 2.
    expect(findUserIndexBefore(messages, 3)).toBe(2);
  });

  it("excludes the endExclusive index itself", () => {
    // endExclusive = 2 means we search [0, 2); index 2 (a user) is excluded,
    // so we find the user at index 0.
    expect(findUserIndexBefore(messages, 2)).toBe(0);
  });

  it("includes index 0 when endExclusive is 1 (range [0,1) holds the first user)", () => {
    // The earlier "excludes endExclusive" test pins the exclusivity; this one
    // pins the lower edge: a bound of 1 still searches index 0.
    expect(findUserIndexBefore(messages, 1)).toBe(0);
  });

  it("clamps endExclusive larger than the array length", () => {
    // Math.min(endExclusive, length) → searches the whole array, last user = 2.
    expect(findUserIndexBefore(messages, 999)).toBe(2);
  });

  it("returns -1 for an endExclusive of 0 (empty search range)", () => {
    expect(findUserIndexBefore(messages, 0)).toBe(-1);
  });

  it("returns -1 for a negative endExclusive", () => {
    expect(findUserIndexBefore(messages, -5)).toBe(-1);
  });

  it("returns -1 on an empty array regardless of the bound", () => {
    expect(findUserIndexBefore([], 5)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// findLastUserMessageText
// ---------------------------------------------------------------------------

describe("findLastUserMessageText", () => {
  it("returns the text of the last user message", () => {
    const messages = [
      makeMessage("user", [textPart("first")]),
      makeMessage("assistant", [textPart("reply")]),
      makeMessage("user", [textPart("latest question")]),
    ];
    expect(findLastUserMessageText(messages)).toBe("latest question");
  });

  it("joins and trims the text parts of the last user message", () => {
    const messages = [
      makeMessage("user", [textPart("  line one  "), textPart("line two")]),
    ];
    expect(findLastUserMessageText(messages)).toBe("line one  \nline two");
  });

  it("returns an empty string when there is no user message", () => {
    const messages = [makeMessage("assistant", [textPart("only assistant")])];
    expect(findLastUserMessageText(messages)).toBe("");
  });

  it("returns an empty string for an empty history", () => {
    expect(findLastUserMessageText([])).toBe("");
  });

  it("returns an empty string when the last user message has only non-text parts", () => {
    const messages = [
      makeMessage("user", [textPart("earlier")]),
      makeMessage("assistant", [textPart("a")]),
      makeMessage("user", [reasoningPart("no text here")]),
    ];
    // The LAST user message is the one with no text parts → empty string,
    // even though an earlier user message had text.
    expect(findLastUserMessageText(messages)).toBe("");
  });
});
