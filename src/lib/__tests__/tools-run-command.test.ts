import { describe, expect, test } from "vitest";
import { runTool } from "@/lib/tools";

describe("run_command tool", () => {
  test("returns command output", async () => {
    const result = (await runTool("run_command", {
      command: "echo shrimp"
    })) as { exitCode: number | null; stdout: string };

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("shrimp");
  });
});
