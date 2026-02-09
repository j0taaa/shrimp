import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/config";
import { createConversation, listConversations } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ conversations: listConversations() });
}

export async function POST() {
  const conversation = createConversation(DEFAULT_MODEL);
  return NextResponse.json({ conversation });
}
