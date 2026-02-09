import { NextResponse } from "next/server";
import { getChannelsStatus } from "@/lib/channels/manager";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getChannelsStatus());
}
