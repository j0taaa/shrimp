import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mockedTriggerConversationRun = vi.fn();

vi.mock("@/lib/jobs", () => ({
  triggerConversationRun: mockedTriggerConversationRun
}));

function nextDbPath() {
  return path.join(os.tmpdir(), `shrimp-jobs-api-${Date.now()}-${Math.random()}.db`);
}

async function setup() {
  vi.resetModules();
  process.env.SHRIMP_DB_PATH = nextDbPath();

  const jobsRoute = await import("@/app/api/jobs/route");
  const store = await import("@/lib/store");

  return { jobsRoute, store };
}

describe("jobs API routes", () => {
  test("lists trigger runs", async () => {
    const { jobsRoute, store } = await setup();

    store.createTriggerRun({
      trigger: "manual",
      instruction: "Hello",
      payload: { x: 1 }
    });

    const res = await jobsRoute.GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs).toHaveLength(1);
  });

  test("triggers conversation run", async () => {
    mockedTriggerConversationRun.mockResolvedValue({
      run: { id: "run-1", status: "success" },
      conversationId: "conv-1",
      resultPreview: "Done"
    });

    const { jobsRoute } = await setup();

    const req = new NextRequest("http://localhost/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Notify me when paid",
        trigger: "webhook",
        payload: { id: "evt_1" }
      })
    });

    const res = await jobsRoute.POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversationId: string };
    expect(body.conversationId).toBe("conv-1");
    expect(mockedTriggerConversationRun).toHaveBeenCalledWith({
      message: "Notify me when paid",
      model: undefined,
      trigger: "webhook",
      payload: { id: "evt_1" }
    });
  });
});
