import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { ALLOWED_MODELS, DEFAULT_MODEL } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai";
import {
  addMessage,
  addToolCall,
  completeToolCall,
  listMessages,
  setConversationTitleIfDefault,
  upsertConversation
} from "@/lib/store";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { runTool, toolDefinitions } from "@/lib/tools";
import type { Message, MessageAttachment, ToolName } from "@/lib/types";

const chatTools = toolDefinitions.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }
}));

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolOutputMessage = OpenAI.Chat.Completions.ChatCompletionToolMessageParam;

export interface AssistantCallbacks {
  onConversation?: (conversationId: string) => void;
  onToolCallStarted?: (payload: { id: string; name: ToolName; input: unknown }) => void;
  onToolCallOutput?: (payload: { id: string; name: ToolName; chunk: string }) => void;
  onToolCallFinished?: (payload: { id: string; name: ToolName; output: unknown; ok: boolean }) => void;
  onAssistantBubbleStart?: (payload: { bubbleId: string }) => void;
  onAssistantToken?: (payload: { bubbleId: string; value: string }) => void;
}

export interface AssistantTurnInput {
  conversationId?: string;
  message: string;
  model?: string;
  replyToMessageId?: string;
  attachments?: MessageAttachment[];
}

export interface AssistantTurnResult {
  conversationId: string;
  messageIds: string[];
  bubbles: string[];
}

function pickModel(requested?: string) {
  if (!requested) return DEFAULT_MODEL;
  if (!ALLOWED_MODELS.includes(requested)) return DEFAULT_MODEL;
  return requested;
}

function chunkText(text: string, chunkSize = 40) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

const STREAM_CHUNK_SIZE = 20;
const STREAM_TOKEN_DELAY_MS = 14;
const STREAM_BUBBLE_DELAY_MS = 120;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function emitBubbleTokens(
  bubbleId: string,
  bubbleText: string,
  callbacks?: AssistantCallbacks,
  isLastBubble = false
) {
  callbacks?.onAssistantBubbleStart?.({ bubbleId });
  for (const chunk of chunkText(bubbleText, STREAM_CHUNK_SIZE)) {
    callbacks?.onAssistantToken?.({ bubbleId, value: chunk });
    await sleep(STREAM_TOKEN_DELAY_MS);
  }

  if (!isLastBubble) {
    await sleep(STREAM_BUBBLE_DELAY_MS);
  }
}

function safeParseArgs(raw: string | null | undefined) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function compactText(value: string, maxChars = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function splitIntoBubbles(text: string) {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [] as string[];

  const byParagraph = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (byParagraph.length > 1) return byParagraph;

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return [normalized];

  const bubbles: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    bubbles.push(sentences.slice(i, i + 2).join(" "));
  }
  return bubbles;
}

function sanitizeAssistantText(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

function buildHistoryMessages(historyRecords: Message[]) {
  const byId = new Map(historyRecords.map((message) => [message.id, message]));

  const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const message of historyRecords) {
    if (message.role === "system") {
      history.push({ role: "system", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      history.push({ role: "assistant", content: message.content });
      continue;
    }

    let contentWithAttachments = message.content;
    if (message.attachments?.length) {
      const attachmentSummaries = message.attachments.map((attachment) => {
        if (attachment.kind === "text") {
          return `- ${attachment.name} (text file) excerpt:\n${(attachment.textContent ?? "").slice(0, 5000)}`;
        }
        if (attachment.kind === "image") {
          return `- ${attachment.name} (image file attached by user)`;
        }
        return `- ${attachment.name} (${attachment.type || "binary file"})`;
      });
      contentWithAttachments = `${contentWithAttachments}\n\nAttached files:\n${attachmentSummaries.join("\n")}`;
    }

    const replied = message.replyToMessageId ? byId.get(message.replyToMessageId) : null;
    if (replied) {
      history.push({
        role: "user",
        content: `Context from replied message: "${compactText(replied.content, 180)}"\n\nUser reply: ${contentWithAttachments}`
      });
    } else {
      history.push({ role: "user", content: contentWithAttachments });
    }
  }

  return history;
}

export async function runAssistantTurn(
  payload: AssistantTurnInput,
  callbacks?: AssistantCallbacks
): Promise<AssistantTurnResult> {
  if (!payload.message?.trim()) {
    throw new Error("message is required");
  }

  const client = getOpenAIClient();
  const model = pickModel(payload.model);
  const conversation = upsertConversation(payload.conversationId, model);

  callbacks?.onConversation?.(conversation.id);

  addMessage(conversation.id, "user", payload.message, {
    replyToMessageId: payload.replyToMessageId,
    attachments: payload.attachments
  });

  const trimmedTitle = payload.message.trim().replace(/\s+/g, " ").slice(0, 60);
  if (trimmedTitle) {
    setConversationTitleIfDefault(conversation.id, trimmedTitle);
  }

  const historyRecords = listMessages(conversation.id);
  const history = buildHistoryMessages(historyRecords);

  const systemPrompt = buildSystemPrompt();
  const workingMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...history];
  let finalAssistantText = "";

  for (let i = 0; i < 8; i += 1) {
    const completion = await client.chat.completions.create({
      model,
      messages: workingMessages,
      tools: chatTools,
      tool_choice: "auto"
    });

    const assistantMessage = completion.choices?.[0]?.message;
    if (!assistantMessage) {
      break;
    }

    const toolCalls = assistantMessage.tool_calls ?? [];
    const assistantText =
      typeof assistantMessage.content === "string" ? sanitizeAssistantText(assistantMessage.content) : "";

    if (toolCalls.length === 0) {
      if (assistantText) {
        finalAssistantText += `${assistantText}\n`;
      }
      break;
    }

    workingMessages.push({
      role: "assistant",
      content: assistantText || "",
      tool_calls: toolCalls
    } satisfies ChatMessage);

    if (assistantText) {
      finalAssistantText += `${assistantText}\n`;
    }

    for (const call of toolCalls) {
      const name = call.function?.name as ToolName;
      const parsedArgs = safeParseArgs(call.function?.arguments);
      const toolCall = addToolCall(conversation.id, name, parsedArgs);

      callbacks?.onToolCallStarted?.({ id: toolCall.id, name, input: parsedArgs });

      try {
        const output = await runTool(name, parsedArgs);
        completeToolCall(toolCall.id, true, output);
        const outputPreview = JSON.stringify(output).slice(0, 800);

        callbacks?.onToolCallOutput?.({
          id: toolCall.id,
          name,
          chunk: outputPreview
        });

        callbacks?.onToolCallFinished?.({
          id: toolCall.id,
          name,
          output,
          ok: true
        });

        const toolMessage: ToolOutputMessage = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(output)
        };
        workingMessages.push(toolMessage);
      } catch (error) {
        const toolError = { error: error instanceof Error ? error.message : "Unknown tool error" };
        completeToolCall(toolCall.id, false, toolError);

        callbacks?.onToolCallOutput?.({
          id: toolCall.id,
          name,
          chunk: JSON.stringify(toolError)
        });

        callbacks?.onToolCallFinished?.({
          id: toolCall.id,
          name,
          output: toolError,
          ok: false
        });

        const toolMessage: ToolOutputMessage = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolError)
        };
        workingMessages.push(toolMessage);
      }
    }
  }

  const bubbles = splitIntoBubbles(finalAssistantText.trim());
  const bubbleGroupId = randomUUID();
  const messageIds: string[] = [];

  if (bubbles.length === 0) {
    const fallbackText = "Done.";
    const fallback = addMessage(conversation.id, "assistant", fallbackText, { bubbleGroupId });
    messageIds.push(fallback.id);
    await emitBubbleTokens(fallback.id, fallbackText, callbacks, true);
  } else {
    for (const [index, bubbleText] of bubbles.entries()) {
      const bubbleMessage = addMessage(conversation.id, "assistant", bubbleText, { bubbleGroupId });
      messageIds.push(bubbleMessage.id);
      await emitBubbleTokens(bubbleMessage.id, bubbleText, callbacks, index === bubbles.length - 1);
    }
  }

  return {
    conversationId: conversation.id,
    messageIds,
    bubbles: bubbles.length > 0 ? bubbles : ["Done."]
  };
}
