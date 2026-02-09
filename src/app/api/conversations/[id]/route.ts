import { NextRequest, NextResponse } from "next/server";
import { getConversation, listMessages, listToolCalls, renameConversation } from "@/lib/store";

export async function GET(_req: NextRequest, context: { params: { id: string } }) {
  const { id } = context.params;
  const conversation = getConversation(id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({
    conversation,
    messages: listMessages(id),
    toolCalls: listToolCalls(id)
  });
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  const { id } = context.params;
  const body = (await req.json()) as { title?: string };
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  renameConversation(id, body.title.trim());
  return NextResponse.json({ ok: true });
}
