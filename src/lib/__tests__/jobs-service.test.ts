import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockedRunAssistantTurn = vi.fn();

vi.mock("@/lib/assistant", () => ({
  runAssistantTurn: mockedRunAssistantTurn
}));

function nextDbPath() {
  return path.join(os.tmpdir(), `shrimp-jobs-service-${Date.now()}-${Math.random()}.db`);
}

async function loadModules() {
  vi.resetModules();
  process.env.SHRIMP_DB_PATH = nextDbPath();

  const store = await import("@/lib/store");
  const jobs = await import("@/lib/jobs");

  return { store, jobs };
}

describe("trigger conversation service", () => {
  beforeEach(() => {
    mockedRunAssistantTurn.mockReset();
  });

  test("executes a trigger run and stores success", async () => {
    const { store, jobs } = await loadModules();
    const conversation = store.createConversation("gpt-4.1-mini", "Generated");

    mockedRunAssistantTurn.mockResolvedValue({
      conversationId: conversation.id,
      messageIds: ["m1"],
      bubbles: ["work complete", "<final_result>/Users/me/file.txt</final_result>"]
    });

    const result = await jobs.triggerConversationRun({
      message: "Use curl to call an API and summarize",
      trigger: "manual",
      payload: { source: "test" }
    });

    expect(result.conversationId).toBe(conversation.id);
    expect(result.finalResult).toBe("/Users/me/file.txt");
    expect(result.resultPreview).toContain("work complete");

    const runs = store.listTriggerRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].conversationId).toBe(conversation.id);
    expect(runs[0].finalResult).toBe("/Users/me/file.txt");
  });

  test("stores failed run when assistant throws", async () => {
    const { store, jobs } = await loadModules();

    mockedRunAssistantTurn.mockRejectedValue(new Error("OpenAI unavailable"));

    await expect(
      jobs.triggerConversationRun({
        message: "Do something",
        trigger: "api"
      })
    ).rejects.toThrow("OpenAI unavailable");

    const runs = store.listTriggerRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("error");
    expect(runs[0].error).toContain("OpenAI unavailable");
  });
});
