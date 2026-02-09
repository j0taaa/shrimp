import { NextRequest } from "next/server";
import { doneChunk, eventToChunk } from "@/lib/sse";
import { runAssistantTurn } from "@/lib/assistant";
import type { MessageAttachment } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as {
    conversationId?: string;
    message: string;
    model?: string;
    replyToMessageId?: string;
    attachments?: MessageAttachment[];
  };

  if (!payload.message?.trim()) {
    return new Response("message is required", { status: 400 });
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        const result = await runAssistantTurn(payload, {
          onConversation: (conversationId) => {
            controller.enqueue(eventToChunk({ type: "conversation", conversationId }));
          },
          onToolCallStarted: (data) => {
            controller.enqueue(
              eventToChunk({
                type: "tool_call_started",
                id: data.id,
                name: data.name,
                input: data.input
              })
            );
          },
          onToolCallOutput: (data) => {
            controller.enqueue(
              eventToChunk({
                type: "tool_call_output",
                id: data.id,
                name: data.name,
                chunk: data.chunk
              })
            );
          },
          onToolCallFinished: (data) => {
            controller.enqueue(
              eventToChunk({
                type: "tool_call_finished",
                id: data.id,
                name: data.name,
                output: data.output,
                ok: data.ok
              })
            );
          },
          onAssistantBubbleStart: (data) => {
            controller.enqueue(eventToChunk({ type: "assistant_bubble_start", bubbleId: data.bubbleId }));
          },
          onAssistantToken: (data) => {
            controller.enqueue(eventToChunk({ type: "token", value: data.value, bubbleId: data.bubbleId }));
          }
        });

        controller.enqueue(eventToChunk({ type: "assistant_done", messageIds: result.messageIds }));
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
