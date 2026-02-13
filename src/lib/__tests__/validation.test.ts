import { describe, expect, test } from "vitest";
import { editFileSchema, runCommandSchema, triggerConversationSchema } from "@/lib/validation";

describe("validation", () => {
  test("enforces command timeout upper bound", () => {
    expect(() =>
      runCommandSchema.parse({
        command: "echo hi",
        timeoutMs: 1000 * 60 * 10
      })
    ).toThrow();
  });

  test("accepts valid edit patch", () => {
    const payload = editFileSchema.parse({
      path: "./file.txt",
      patches: [{ startLine: 1, endLine: 1, newText: "updated" }]
    });

    expect(payload.patches).toHaveLength(1);
  });

  test("accepts valid trigger conversation payload", () => {
    const payload = triggerConversationSchema.parse({
      message: "Check Stripe payments and notify me",
      trigger: "webhook",
      payload: { event: "invoice.paid" }
    });

    expect(payload.trigger).toBe("webhook");
  });

  test("defaults trigger to api", () => {
    const payload = triggerConversationSchema.parse({ message: "Hello" });
    expect(payload.trigger).toBe("api");
  });
});
