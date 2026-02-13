import { NextRequest, NextResponse } from "next/server";
import { triggerConversationRun } from "@/lib/jobs";
import { listTriggerRuns } from "@/lib/store";
import { triggerConversationSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ runs: listTriggerRuns(150) });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const payload = triggerConversationSchema.parse(raw);

    const result = await triggerConversationRun({
      message: payload.message,
      model: payload.model,
      trigger: payload.trigger,
      payload: payload.payload
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
}
