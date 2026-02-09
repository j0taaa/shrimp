import { NextRequest, NextResponse } from "next/server";
import { deleteMessage, updateMessageContent } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { content?: string };

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  updateMessageContent(id, content);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  deleteMessage(id);
  return NextResponse.json({ ok: true });
}
