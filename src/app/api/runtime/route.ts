import { NextResponse } from "next/server";
import { ALLOWED_MODELS, DEFAULT_MODEL, runtimeInfo } from "@/lib/config";
import { db } from "@/lib/db";
import { listShellSessions } from "@/lib/shell/session-manager";

export async function GET() {
  const info = runtimeInfo();
  let dbStatus = "ok";
  try {
    db.prepare("SELECT 1").get();
  } catch {
    dbStatus = "error";
  }
  return NextResponse.json({
    runtime: info,
    db: { status: dbStatus },
    models: {
      defaultModel: DEFAULT_MODEL,
      allowedModels: ALLOWED_MODELS
    },
    shellSessions: listShellSessions().map((session) => ({
      id: session.id,
      cwd: session.cwd,
      shell: session.shell,
      platform: session.platform,
      lastUsedAt: session.lastUsedAt
    }))
  });
}
