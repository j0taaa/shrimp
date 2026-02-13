import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "@/lib/system-prompt";

describe("system prompt knowledge skills policy", () => {
  test("includes repo-local knowledge folder guidance", () => {
    const prompt = buildSystemPrompt();
    const expectedRoot = path.join(process.cwd(), "knowledge");

    expect(prompt).toContain(`The canonical project knowledge root is ${expectedRoot}.`);
    expect(prompt).toContain(`Skills root: ${expectedRoot}/skills.`);
    expect(prompt).toContain(`Facts root: ${expectedRoot}/facts.`);
    expect(prompt).toContain("Each skills topic folder must have SKILL.md as the primary guide.");
    expect(prompt).toContain("Each facts folder must have FACTS.md as the primary document.");
    expect(prompt).toContain("Before creating a new skills or facts folder, search existing folders under /knowledge to avoid duplicates.");
    expect(prompt).toContain("update_system_prompt_memory is for always-relevant, high-priority persistent guidance/preferences.");
    expect(prompt).toContain(`${expectedRoot}/skills/** is for reusable procedural know-how and error-resolution workflows.`);
    expect(prompt).toContain(`${expectedRoot}/facts/** is for situational facts needed only for some requests.`);
  });
});
