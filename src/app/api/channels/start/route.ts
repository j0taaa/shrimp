import { NextRequest, NextResponse } from "next/server";
import { getChannelsStatus, startChannels } from "@/lib/channels/manager";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { channel?: "telegram" | "whatsapp" | "all" };
  const channel = body.channel ?? "all";

  if (!["telegram", "whatsapp", "all"].includes(channel)) {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  await startChannels(channel);
  return NextResponse.json(getChannelsStatus());
}
