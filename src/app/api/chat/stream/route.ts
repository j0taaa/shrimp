import { NextRequest } from "next/server";
import { ALLOWED_MODELS, DEFAULT_MODEL } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai";
import { doneChunk, eventToChunk } from "@/lib/sse";
import {
  addMessage,
  addToolCall,
  completeToolCall,
  listMessages,
  setConversationTitleIfDefault,
  upsertConversation
} from "@/lib/store";
import { runTool, toolDefinitions } from "@/lib/tools";
import type { ToolName } from "@/lib/types";

export const runtime = "nodejs";

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

function safeParseArgs(raw: string | null | undefined) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const chatTools = toolDefinitions.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }
}));

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as {
    conversationId?: string;
    message: string;
    model?: string;
  };

  if (!payload.message?.trim()) {
    return new Response("message is required", { status: 400 });
  }

  const client = getOpenAIClient();
  const model = pickModel(payload.model);
  const conversation = upsertConversation(payload.conversationId, model);

  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        controller.enqueue(eventToChunk({ type: "conversation", conversationId: conversation.id }));

        addMessage(conversation.id, "user", payload.message);
        const trimmedTitle = payload.message.trim().replace(/\s+/g, " ").slice(0, 60);
        if (trimmedTitle) {
          setConversationTitleIfDefault(conversation.id, trimmedTitle);
        }

        const history = listMessages(conversation.id).map((msg) => ({
          role: msg.role,
          content: msg.content
        }));

        const workingMessages: any[] = [...history];
        let finalAssistantText = "";

        for (let i = 0; i < 8; i += 1) {
          const completion: any = await client.chat.completions.create({
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
          const assistantText = typeof assistantMessage.content === "string" ? assistantMessage.content : "";

          if (toolCalls.length === 0) {
            if (assistantText) {
              finalAssistantText += assistantText;
              for (const chunk of chunkText(assistantText)) {
                controller.enqueue(eventToChunk({ type: "token", value: chunk }));
              }
            }
            break;
          }

          workingMessages.push({
            role: "assistant",
            content: assistantText || "",
            tool_calls: toolCalls
          });

          if (assistantText) {
            finalAssistantText += `${assistantText}\n`;
            for (const chunk of chunkText(`${assistantText}\n`)) {
              controller.enqueue(eventToChunk({ type: "token", value: chunk }));
            }
          }

          for (const call of toolCalls) {
            const name = call.function?.name as ToolName;
            const parsedArgs = safeParseArgs(call.function?.arguments);
            const toolCall = addToolCall(conversation.id, name, parsedArgs);

            controller.enqueue(
              eventToChunk({
                type: "tool_call_started",
                id: toolCall.id,
                name,
                input: parsedArgs
              })
            );

            try {
              const output = await runTool(name, parsedArgs);
              completeToolCall(toolCall.id, true, output);
              const outputPreview = JSON.stringify(output).slice(0, 800);

              controller.enqueue(
                eventToChunk({
                  type: "tool_call_output",
                  id: toolCall.id,
                  name,
                  chunk: outputPreview
                })
              );

              controller.enqueue(
                eventToChunk({
                  type: "tool_call_finished",
                  id: toolCall.id,
                  name,
                  output,
                  ok: true
                })
              );

              workingMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(output)
              });
            } catch (error) {
              const toolError = { error: error instanceof Error ? error.message : "Unknown tool error" };
              completeToolCall(toolCall.id, false, toolError);

              controller.enqueue(
                eventToChunk({
                  type: "tool_call_output",
                  id: toolCall.id,
                  name,
                  chunk: JSON.stringify(toolError)
                })
              );

              controller.enqueue(
                eventToChunk({
                  type: "tool_call_finished",
                  id: toolCall.id,
                  name,
                  output: toolError,
                  ok: false
                })
              );

              workingMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(toolError)
              });
            }
          }
        }

        const assistant = addMessage(conversation.id, "assistant", finalAssistantText.trim() || "Done.");
        controller.enqueue(eventToChunk({ type: "assistant_done", messageId: assistant.id }));
        controller.enqueue(doneChunk());
        controller.close();
      } catch (error) {
        controller.enqueue(
          eventToChunk({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error"
          })
        );
        controller.enqueue(doneChunk());
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
