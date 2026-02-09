import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runTool } from "@/lib/tools";

describe("edit_file tool", () => {
  test("applies line-range patch", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-"));
    const target = path.join(tmpDir, "file.txt");
    fs.writeFileSync(target, "a\nb\nc\n", "utf8");

    const result = (await runTool("edit_file", {
      path: target,
      patches: [{ startLine: 2, endLine: 2, newText: "B" }]
    })) as { applied: boolean; hunksApplied: number };

    const updated = fs.readFileSync(target, "utf8");
    expect(result.applied).toBe(true);
    expect(result.hunksApplied).toBe(1);
    expect(updated).toContain("a\nB\nc");
  });
});
