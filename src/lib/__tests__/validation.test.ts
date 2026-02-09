import { describe, expect, test } from "vitest";
import { runCommandSchema, editFileSchema } from "@/lib/validation";

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
});
