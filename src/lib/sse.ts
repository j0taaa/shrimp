import type { ChatStreamEvent } from "@/lib/types";

const encoder = new TextEncoder();

export function eventToChunk(event: ChatStreamEvent) {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function doneChunk() {
  return encoder.encode("data: [DONE]\n\n");
}
