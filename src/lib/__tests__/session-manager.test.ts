import { describe, expect, test } from "vitest";
import { createShellSession, runCommand } from "@/lib/shell/session-manager";

describe("shell sessions", () => {
  test("preserves cwd across sequential commands", async () => {
    const session = createShellSession(process.cwd());
    const first = await runCommand({ sessionId: session.id, command: "pwd" });
    expect(first.exitCode).toBe(0);

    const cdResult = await runCommand({ sessionId: session.id, command: "cd src" });
    expect(cdResult.exitCode).toBe(0);

    const second = await runCommand({ sessionId: session.id, command: "pwd" });
    expect(second.stdout).toContain("src");
  });
});
