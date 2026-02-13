import { describe, expect, test } from "vitest";
import { runTool } from "@/lib/tools";

describe("write_stdin tool", () => {
  test("can continue an interactive command", async () => {
    const session = (await runTool("create_shell_session", {})) as { sessionId: string };

    const started = (await runTool("run_command", {
      sessionId: session.sessionId,
      command: "read line; echo got:$line",
      interactive: true,
      timeoutMs: 50
    })) as { timedOut: boolean };

    expect(started.timedOut).toBe(true);

    const continued = (await runTool("write_stdin", {
      sessionId: session.sessionId,
      chars: "shrimp\n",
      yieldMs: 200
    })) as {
      stdout: string;
      completed?: { exitCode: number | null };
    };

    expect(continued.stdout).toContain("got:shrimp");
    expect(continued.completed?.exitCode).toBe(0);

    await runTool("close_shell_session", { sessionId: session.sessionId });
  });
});
