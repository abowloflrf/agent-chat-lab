import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  convertToModelMessages,
  isStepCount,
  type FinishReason,
} from "ai";
import { after } from "next/server";
import { z } from "zod";
import {
  ASK_USER_QUESTION_PART_TYPE,
  buildUnansweredOutput,
} from "@/lib/ai/ask-user-question";
import { getChatModel, sessionHeaders } from "@/lib/ai/model";
import {
  buildMcpContextPrompt,
  buildSkillContextPrompt,
  buildTimeContextPrompt,
  buildWebSearchContextPrompt,
  systemPrompt,
} from "@/lib/ai/system-prompt";
import { createAgentTools } from "@/lib/ai/tools";
import { hasAnySearchProvider } from "@/lib/ai/web-search";
import { repairToolCall } from "@/lib/ai/repair-tool-call";
import { connectMcpServers, type McpServerToolInfo } from "@/lib/ai/mcp";
import { resolveBaseUrl } from "@/lib/ai/mcp-oauth";
import { discoverSkills, type SkillInfo } from "@/lib/ai/skills";
import {
  persistFinishedConversation,
  persistIncomingMessages,
  generateConversationTitle,
  saveConversationSessionConfig,
} from "@/lib/persistence";
import type {
  AgentTimelineStep,
  ChatMessageMetadata,
  ChatUIMessage,
} from "@/lib/observability";
import {
  getSystemSettings,
  getConfiguredMcpServersFromSettings,
  getEnabledMcpServersFromSettings,
  getRuntimeProviderConfigFromSettings,
  getProviderConfigByOverrideFromSettings,
} from "@/lib/settings";

export const runtime = "nodejs";
const AGENT_MAX_STEPS = 12;
export const maxDuration = 300;

const modelOverrideSchema = z.object({
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
});

const requestSchema = z.object({
  conversationId: z.string().trim().min(1),
  messages: z.array(z.custom<ChatUIMessage>()),
  modelOverride: modelOverrideSchema.optional(),
  // 本次会话收窄的启用清单：缺省（undefined）表示不收窄，沿用服务端默认全开；
  // 数组（含空数组）表示精确启用集合，与全局设置取交集后生效。
  enabledMcpServerIds: z.array(z.string().trim().min(1)).optional(),
  enabledSkillNames: z.array(z.string().trim().min(1)).optional(),
});

function stripMessageId(message: ChatUIMessage): Omit<ChatUIMessage, "id"> {
  const { id, ...rest } = message;
  void id;
  return rest;
}

type OpenAIItemIdCarrier = {
  providerOptions?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
};

function stripOpenAIItemIdFromProviderMap(
  providerMap: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const openai = providerMap?.openai;

  if (
    !openai ||
    typeof openai !== "object" ||
    Array.isArray(openai) ||
    !("itemId" in openai)
  ) {
    return providerMap;
  }

  const { itemId, ...openAIWithoutItemId } = openai as Record<string, unknown>;
  void itemId;

  const nextProviderMap = { ...providerMap };
  if (Object.keys(openAIWithoutItemId).length > 0) {
    nextProviderMap.openai = openAIWithoutItemId;
  } else {
    delete nextProviderMap.openai;
  }

  return Object.keys(nextProviderMap).length > 0 ? nextProviderMap : undefined;
}

function stripOpenAIResponseItemIds(
  messages: ChatUIMessage[],
): ChatUIMessage[] {
  let changed = false;
  const nextMessages = messages.map((message) => {
    let partsChanged = false;
    const nextParts = message.parts.map((part) => {
      const carrier = part as ChatUIMessage["parts"][number] & OpenAIItemIdCarrier;
      const nextProviderOptions = stripOpenAIItemIdFromProviderMap(
        carrier.providerOptions,
      );
      const nextProviderMetadata = stripOpenAIItemIdFromProviderMap(
        carrier.providerMetadata,
      );

      if (
        nextProviderOptions === carrier.providerOptions &&
        nextProviderMetadata === carrier.providerMetadata
      ) {
        return part;
      }

      partsChanged = true;
      const nextPart = {
        ...part,
      } as ChatUIMessage["parts"][number] & OpenAIItemIdCarrier;

      if (nextProviderOptions === undefined) {
        delete nextPart.providerOptions;
      } else {
        nextPart.providerOptions = nextProviderOptions;
      }

      if (nextProviderMetadata === undefined) {
        delete nextPart.providerMetadata;
      } else {
        nextPart.providerMetadata = nextProviderMetadata;
      }

      return nextPart as ChatUIMessage["parts"][number];
    });

    if (!partsChanged) {
      return message;
    }

    changed = true;
    return { ...message, parts: nextParts };
  });

  return changed ? nextMessages : messages;
}

/**
 * Auto-reject any tool calls still in "approval-requested" state.
 *
 * When a high-risk Bash command is blocked and the user sends a new message
 * without clicking "Reject", the conversation history contains a tool call
 * with no tool result.  `convertToModelMessages` faithfully emits the
 * tool-call but never emits a matching tool-result, which makes the model
 * API return "Tool result is missing for tool call …".
 *
 * This function patches those dangling parts to "output-denied" so the SDK
 * can generate a proper tool-result / tool-approval-response pair.
 */
function autoRejectPendingApprovals(messages: ChatUIMessage[]): ChatUIMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    let changed = false;
    const nextParts = message.parts.map((part) => {
      const isToolPart =
        part.type === "dynamic-tool" || part.type.startsWith("tool-");
      if (
        !isToolPart ||
        !("state" in part) ||
        part.state !== "approval-requested"
      ) {
        return part;
      }

      changed = true;
      const toolCallId = part.toolCallId;
      const existingApproval = part.approval as { id: string } | undefined;
      const approvalId = existingApproval?.id ?? `auto-reject-${toolCallId}`;

      return {
        ...part,
        state: "output-denied" as const,
        approval: {
          id: approvalId,
          approved: false as const,
          reason: "工具调用未经用户审批，已自动拒绝。",
        },
      };
    });

    return changed ? { ...message, parts: nextParts } : message;
  });
}

/**
 * Resolve dangling AskUserQuestion calls left in "input-available" state.
 *
 * AskUserQuestion is a client-side tool (no execute): when the user answers
 * the question card, the frontend patches the part to "output-available"
 * before sending.  So any AskUserQuestion part that arrives here still in
 * "input-available" means the user skipped the card and sent a new message
 * directly — without a tool result, `convertToModelMessages` would fail the
 * same way as dangling approvals.  Patch in an "unanswered" output that
 * tells the model to follow the user's latest message instead.
 */
function resolveUnansweredQuestions(messages: ChatUIMessage[]): ChatUIMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    let changed = false;
    const nextParts = message.parts.map((part) => {
      if (part.type !== ASK_USER_QUESTION_PART_TYPE) {
        return part;
      }
      if (!("state" in part) || part.state !== "input-available") {
        return part;
      }

      changed = true;
      return {
        ...part,
        state: "output-available" as const,
        output: buildUnansweredOutput(),
      };
    });

    return changed ? { ...message, parts: nextParts } : message;
  });
}

/**
 * Settle tool calls interrupted mid-execution (e.g. the stream died while a
 * server tool was running, then the client recovered and sent a new message).
 *
 * Such parts arrive as `input-streaming` / `input-available` with no output —
 * or as `approval-responded` with no output when the run died after the user
 * approved but before the tool finished.  `convertToModelMessages` emits a
 * tool-call for these but never a matching tool-result, so the provider
 * rejects the request.  Drop parts whose input never finished streaming, and
 * patch complete-but-unexecuted calls to an error/denied result.
 *
 * `approval-responded` is only settled in non-final assistant messages: a
 * trailing assistant message with approval-responded parts is exactly the
 * legitimate approval-continuation request, which streamText must execute.
 *
 * Must run AFTER `resolveUnansweredQuestions` so pending AskUserQuestion
 * parts have already been given their "unanswered" output.
 */
function settleInterruptedToolCalls(messages: ChatUIMessage[]): ChatUIMessage[] {
  const lastIndex = messages.length - 1;

  return messages.map((message, messageIndex) => {
    if (message.role !== "assistant") {
      return message;
    }

    const isLastMessage = messageIndex === lastIndex;
    let changed = false;
    const nextParts = message.parts.flatMap((part) => {
      const isToolPart =
        part.type === "dynamic-tool" || part.type.startsWith("tool-");

      if (!isToolPart || !("state" in part)) {
        return [part];
      }

      if (part.state === "input-streaming") {
        changed = true;
        return [];
      }

      if (part.state === "input-available") {
        changed = true;
        return [
          {
            ...part,
            state: "output-error",
            errorText: "执行被中断，未返回结果。",
          } as ChatUIMessage["parts"][number],
        ];
      }

      if (
        part.state === "approval-responded" &&
        !isLastMessage &&
        !("output" in part && part.output !== undefined)
      ) {
        changed = true;
        const approval = (part as { approval?: { approved?: boolean } }).approval;

        if (approval?.approved === false) {
          return [
            { ...part, state: "output-denied" } as ChatUIMessage["parts"][number],
          ];
        }

        return [
          {
            ...part,
            state: "output-error",
            errorText: "已批准但执行被中断，未返回结果。",
          } as ChatUIMessage["parts"][number],
        ];
      }

      return [part];
    });

    return changed ? { ...message, parts: nextParts } : message;
  });
}

function toNonNegativeInt(value: number | undefined) {
  return value === undefined ? 0 : Math.max(0, Math.round(value));
}

function buildRuntimeSystemPrompt(
  messages: ChatUIMessage[],
  mcpServers: McpServerToolInfo[],
  skills: SkillInfo[],
  webSearchAvailable: boolean,
) {
  // Pin time to the conversation's first message so the entire system
  // prompt stays identical for every request in the same session,
  // maximizing prefix-cache hits.  Falls back to now for the very
  // first message (which hasn't been persisted yet).
  const firstMessageCreatedAt = messages[0]?.metadata?.createdAt;
  const pinnedNow =
    typeof firstMessageCreatedAt === "number"
      ? new Date(firstMessageCreatedAt)
      : new Date();

  // Prefer the TZ env var (e.g. injected via docker-compose); otherwise fall
  // back to the runtime's resolved zone. Ignore an invalid TZ value.
  const runtimeTimeZone =
    new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const envTimeZone = process.env.TZ?.trim();
  let timeZone = runtimeTimeZone;
  if (envTimeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: envTimeZone });
      timeZone = envTimeZone;
    } catch {
      // Invalid TZ value; keep the runtime zone.
    }
  }

  const currentDateTime = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone,
  }).format(pinnedNow);
  const promptSections = [systemPrompt];

  // Citation guidance is only relevant when the web tools can actually run.
  if (webSearchAvailable) {
    promptSections.push(buildWebSearchContextPrompt());
  }

  const skillSection = buildSkillContextPrompt(skills);
  if (skillSection) {
    promptSections.push(skillSection);
  }

  const mcpSection = buildMcpContextPrompt(mcpServers);
  if (mcpSection) {
    promptSections.push(mcpSection);
  }

  promptSections.push(
    buildTimeContextPrompt(currentDateTime, pinnedNow.toISOString(), timeZone),
  );

  return promptSections.join("\n\n").trim();
}

/** 把任意错误压成一行可读文案，带上错误名与 cause，便于日志与前端展示。 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const head =
      error.name && error.name !== "Error"
        ? `${error.name}: ${error.message}`
        : error.message || error.name;
    const cause =
      error.cause instanceof Error
        ? error.cause.message
        : error.cause != null
          ? String(error.cause)
          : "";
    return cause ? `${head}（cause: ${cause}）` : head;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type ChatErrorContext = {
  conversationId: string;
  provider: string;
  model: string;
  startedAt: number;
  steps: number;
};

/** 统一记录聊天流错误：一行带上下文的摘要 + 原始错误对象（含堆栈）。 */
function logChatError(
  stage: string,
  error: unknown,
  ctx: ChatErrorContext,
): void {
  console.error(
    `[chat] ${stage} failed conv=${ctx.conversationId} ` +
      `provider=${ctx.provider || "?"} model=${ctx.model || "?"} ` +
      `elapsed=${Date.now() - ctx.startedAt}ms steps=${ctx.steps} :: ${describeError(error)}`,
    error,
  );
}

function buildStreamingMetadata(
  requestStartedAt: number,
  timeline: AgentTimelineStep[],
): ChatMessageMetadata {
  return {
    createdAt: requestStartedAt,
    status: "streaming" as const,
    startedAt: requestStartedAt,
    timeline,
  };
}

function buildFinishedMetadata(
  requestStartedAt: number,
  requestFinishedAt: number,
  timeline: AgentTimelineStep[],
): ChatMessageMetadata {
  return {
    createdAt: requestStartedAt,
    status: "finished" as const,
    startedAt: requestStartedAt,
    finishedAt: requestFinishedAt,
    totalDurationMs: Math.max(0, requestFinishedAt - requestStartedAt),
    timeline,
  };
}

function buildLimitReachedText(
  finishReason: FinishReason | undefined,
  timeline: AgentTimelineStep[],
) {
  const lastStep = timeline[timeline.length - 1];

  if (!lastStep) {
    return null;
  }

  const reachedStepLimitWhileToolLooping =
    timeline.length >= AGENT_MAX_STEPS &&
    (finishReason === "tool-calls" || lastStep.finishReason === "tool-calls") &&
    lastStep.toolCalls.length > 0 &&
    lastStep.toolResults.length > 0;

  if (!reachedStepLimitWhileToolLooping) {
    return null;
  }

  const recentToolNames = [...new Set(lastStep.toolCalls.map((toolCall) => toolCall.toolName))].slice(0, 3);
  const toolSummary =
    recentToolNames.length > 0
      ? `最后一轮已执行工具：${recentToolNames.join("、")}。`
      : "";

  return `${toolSummary}本轮 Agent 已达到最多 ${AGENT_MAX_STEPS} 步的执行上限，我先在这里收尾，避免直接断流。若你希望我继续，请直接回复“继续”，或缩小任务范围后再试。`;
}

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: missing valid conversation or messages.",
      },
      { status: 400 },
    );
  }

  // Read system settings once, then derive both the provider config and the
  // MCP server list from that single snapshot instead of querying twice.
  const settings = await getSystemSettings();
  const providerConfig = parsed.data.modelOverride
    ? getProviderConfigByOverrideFromSettings(
        settings,
        parsed.data.modelOverride.providerId,
        parsed.data.modelOverride.modelId,
      )
    : getRuntimeProviderConfigFromSettings(settings);
  // 会话给了显式清单：从所有已配置服务里选（可放行默认未开启的）；缺省则沿用全局默认开启。
  const sessionMcpServerIds = parsed.data.enabledMcpServerIds
    ? new Set(parsed.data.enabledMcpServerIds)
    : null;
  const mcpServers = sessionMcpServerIds
    ? getConfiguredMcpServersFromSettings(settings).filter((server) =>
        sessionMcpServerIds.has(server.id),
      )
    : getEnabledMcpServersFromSettings(settings);

  // Skills 来自文件系统。会话给了显式清单则按清单（可放行默认禁用的）；缺省用设置禁用名单
  // 过滤。读盘很快，串行 await 即可；放在 createAgentTools 之前，让历史里的 Skill 工具调用
  // 也能被解析。
  const disabledSkillNames = new Set(settings.disabledSkills);
  const sessionSkillNames = parsed.data.enabledSkillNames
    ? new Set(parsed.data.enabledSkillNames)
    : null;
  const enabledSkills = (await discoverSkills()).filter((skill) =>
    sessionSkillNames
      ? sessionSkillNames.has(skill.name)
      : !disabledSkillNames.has(skill.name),
  );
  const enabledSkillNames = new Set(enabledSkills.map((skill) => skill.name));
  const agentTools = createAgentTools(providerConfig, enabledSkillNames);

  const sanitizedMessages = settleInterruptedToolCalls(
    resolveUnansweredQuestions(autoRejectPendingApprovals(parsed.data.messages)),
  );
  const messagesForRequest =
    providerConfig.protocol === "openai-response"
      ? stripOpenAIResponseItemIds(sanitizedMessages)
      : sanitizedMessages;
  const modelMessages = await convertToModelMessages(
    messagesForRequest.map(stripMessageId),
    {
      tools: agentTools,
      // 防御性兜底：上面的 sanitize 链应已消化所有未完成的工具调用，
      // 万一漏掉也不要把悬空 tool-call 发给 provider。
      ignoreIncompleteToolCalls: true,
    },
  );

  if (!providerConfig.apiKey || !providerConfig.model) {
    return Response.json(
      {
        error:
          "No valid model configuration. Please configure base URL, API Key and model at /settings, or set OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL environment variables.",
      },
      { status: 400 },
    );
  }

  // Persist the incoming messages and open MCP connections in parallel so the
  // MCP handshake doesn't queue behind the DB write. connectMcpServers never
  // throws (per-server failures are swallowed), so only the persist can
  // reject — in which case we still close any connections that opened.
  const mcpBundlePromise = connectMcpServers(mcpServers, resolveBaseUrl(request));

  try {
    await persistIncomingMessages(parsed.data.conversationId, messagesForRequest);
    // 把本轮实际使用的模型 / MCP / Skills 选择写回会话，使其在下次打开时恢复。
    // 缺省字段写 null：模型缺省=沿用全局默认，数组缺省=未收窄（默认全开）。
    await saveConversationSessionConfig(parsed.data.conversationId, {
      modelProviderId: parsed.data.modelOverride?.providerId ?? null,
      modelId: parsed.data.modelOverride?.modelId ?? null,
      enabledMcpServerIds: parsed.data.enabledMcpServerIds ?? null,
      enabledSkillNames: parsed.data.enabledSkillNames ?? null,
    });
  } catch (error) {
    void mcpBundlePromise.then((bundle) => bundle.close());
    throw error;
  }

  // Built-in tools take precedence so a remote server cannot shadow
  // Bash/WebSearch/etc.
  const mcpBundle = await mcpBundlePromise;
  const tools = { ...mcpBundle.tools, ...agentTools };

  // Only advertise MCP tools that survive into the final tool set. A built-in
  // wins on name collision, so an MCP tool sharing a built-in's name resolves
  // to the built-in — advertising it as MCP-provided would mislead the model.
  const builtInToolNames = new Set(Object.keys(agentTools));
  const advertisedMcpServers = mcpBundle.servers
    .map((server) => ({
      serverName: server.serverName,
      toolNames: server.toolNames.filter((name) => !builtInToolNames.has(name)),
    }))
    .filter((server) => server.toolNames.length > 0);

  // Build the prompt after connecting so it can advertise the MCP tools that
  // actually came online this turn.
  const runtimeSystemPrompt = buildRuntimeSystemPrompt(
    messagesForRequest,
    advertisedMcpServers,
    enabledSkills,
    hasAnySearchProvider(providerConfig),
  );

  const requestStartedAt = Date.now();
  const stepStartTimes = new Map<number, number>();
  const timeline: AgentTimelineStep[] = [];
  let requestFinishedAt: number | undefined;

  const result = streamText({
    model: getChatModel(providerConfig),
    headers: sessionHeaders(parsed.data.conversationId),
    system: runtimeSystemPrompt,
    messages: modelMessages,
    tools,
    providerOptions:
      providerConfig.protocol === "openai-response"
        ? {
            openai: {
              store: false,
              promptCacheKey: parsed.data.conversationId,
              reasoningSummary: "auto",
            },
          }
        : undefined,
    // 确定性纠偏：把模型按 Claude Code 习惯发来的工具调用（大写名、file_path
    // 等参数键）就地翻译成本地工具契约，省掉“先错一次再重试”的额外往返。
    experimental_repairToolCall: repairToolCall,
    stopWhen: isStepCount(AGENT_MAX_STEPS),
    // Stop generating when the client disconnects or hits "stop", and close
    // MCP connections on every terminal path (finish / error / abort).
    abortSignal: request.signal,
    onFinish: () => {
      void mcpBundle.close();
    },
    onError: (event) => {
      logChatError("stream", event.error, {
        conversationId: parsed.data.conversationId,
        provider: providerConfig.providerName,
        model: providerConfig.model,
        startedAt: requestStartedAt,
        steps: timeline.length,
      });
      void mcpBundle.close();
    },
    onAbort: () => {
      // 中断不是异常（多为客户端断连或反代 proxy_read_timeout 掐流），单独记一条
      // warn 便于和真正的报错区分，也让“等很久后中断”这类静默失败可被归因。
      console.warn(
        `[chat] stream aborted conv=${parsed.data.conversationId} ` +
          `provider=${providerConfig.providerName || "?"} model=${providerConfig.model || "?"} ` +
          `elapsed=${Date.now() - requestStartedAt}ms steps=${timeline.length}`,
      );
      void mcpBundle.close();
    },
    experimental_onStepStart: ({ stepNumber }) => {
      stepStartTimes.set(stepNumber, Date.now());
    },
    onStepFinish: (step) => {
      const finishedAt = Date.now();
      const startedAt = stepStartTimes.get(step.stepNumber) ?? finishedAt;

      timeline.push({
        event: "step-finish",
        stepNumber: step.stepNumber,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        finishReason: step.finishReason,
        provider: providerConfig.providerName || step.model.provider,
        modelId: step.model.modelId,
        text: step.text,
        toolCalls: step.toolCalls.map((toolCall) => ({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
        })),
        toolResults: step.toolResults.map((toolResult) => ({
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
        })),
        usage: {
          inputTokens: toNonNegativeInt(step.usage.inputTokens),
          outputTokens: toNonNegativeInt(step.usage.outputTokens),
          totalTokens: toNonNegativeInt(step.usage.totalTokens),
          reasoningTokens: toNonNegativeInt(step.usage.outputTokenDetails.reasoningTokens),
          cachedInputTokens: toNonNegativeInt(step.usage.inputTokenDetails.cacheReadTokens),
        },
      });

      stepStartTimes.delete(step.stepNumber);
    },
  });

  // Use the sanitized history so onFinish persistence doesn't resurrect
  // dangling approval-requested / input-available parts into the DB.
  const uiMessageStream = createUIMessageStream<ChatUIMessage>({
    originalMessages: messagesForRequest,
    // 既把流式过程中的真实错误记到服务端日志，也作为可读文案发回前端错误横幅，
    // 不再被 SDK 默认替换成通用的 "An error occurred."。
    onError: (error) => {
      logChatError("ui-stream", error, {
        conversationId: parsed.data.conversationId,
        provider: providerConfig.providerName,
        model: providerConfig.model,
        startedAt: requestStartedAt,
        steps: timeline.length,
      });
      return `执行出错：${describeError(error)}`;
    },
    execute: async ({ writer }) => {
      const innerStream = result.toUIMessageStream<ChatUIMessage>({
        messageMetadata: ({ part }) => {
          if (part.type === "start") {
            return buildStreamingMetadata(requestStartedAt, []);
          }

          if (part.type === "finish-step") {
            return buildStreamingMetadata(requestStartedAt, timeline);
          }
        },
        sendFinish: false,
      });

      const reader = innerStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          writer.write(value);
        }
      } finally {
        reader.releaseLock();
      }

      let finishReason: FinishReason | undefined;

      try {
        finishReason = await result.finishReason;
      } catch {
        finishReason = "error";
      }

      const limitReachedText = buildLimitReachedText(finishReason, timeline);

      if (limitReachedText) {
        const partId = `limit-note-${crypto.randomUUID()}`;
        const hasExistingText = timeline.some((step) => step.text.trim().length > 0);

        writer.write({
          type: "text-start",
          id: partId,
        });
        writer.write({
          type: "text-delta",
          id: partId,
          delta: `${hasExistingText ? "\n\n" : ""}${limitReachedText}`,
        });
        writer.write({
          type: "text-end",
          id: partId,
        });
      }

      requestFinishedAt ??= Date.now();
      writer.write({
        type: "finish",
        finishReason,
        messageMetadata: buildFinishedMetadata(
          requestStartedAt,
          requestFinishedAt,
          timeline,
        ),
      });
    },
    onFinish: async ({ messages }) => {
      const messagesToPersist =
        providerConfig.protocol === "openai-response"
          ? stripOpenAIResponseItemIds(messages)
          : messages;

      await persistFinishedConversation(parsed.data.conversationId, messagesToPersist);

      const userMessages = messagesToPersist.filter((m) => m.role === "user");
      const assistantMessages = messagesToPersist.filter((m) => m.role === "assistant");

      if (userMessages.length === 1 && assistantMessages.length === 1) {
        after(async () => {
          await generateConversationTitle(
            parsed.data.conversationId,
            messagesToPersist,
            providerConfig,
          );
        });
      }
    },
  });

  return createUIMessageStreamResponse({
    stream: uiMessageStream,
  });
}
