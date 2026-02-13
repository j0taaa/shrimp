import { DEFAULT_MODEL } from "@/lib/config";
import { runAssistantTurn } from "@/lib/assistant";
import {
  completeTriggerRun,
  createTriggerRun,
  getTriggerRun,
  setTriggerRunConversationId
} from "@/lib/store";
import type { TriggerRun } from "@/lib/types";

function compact(value: string, max = 4000) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function extractFinalResult(text: string) {
  const match = text.match(/<final_result>([\s\S]*?)<\/final_result>/i);
  if (!match) return undefined;
  const normalized = match[1].replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function buildRunMessage(message: string, payload: unknown) {
  return [
    message,
    "",
    "Trigger payload JSON:",
    JSON.stringify(payload ?? null, null, 2),
    "",
    "You have the same tool autonomy as regular chat, including terminal commands via run_command (for example using curl when needed).",
    "Keep visible assistant text minimal. Prefer tool calls and concise status.",
    "If the task asks for a machine-friendly final output, include <final_result>...</final_result>."
  ].join("\n");
}

function previewFromRunResult(runResult: Awaited<ReturnType<typeof runAssistantTurn>>) {
  return compact(runResult.bubbles.join("\n\n"), 500);
}

export async function triggerConversationRun(input: {
  message: string;
  model?: string;
  trigger: TriggerRun["trigger"];
  payload?: unknown;
}) {
  const run = createTriggerRun({
    trigger: input.trigger,
    instruction: input.message,
    model: input.model,
    payload: input.payload
  });

  try {
    const assistantResult = await runAssistantTurn({
      message: buildRunMessage(input.message, input.payload),
      model: input.model ?? DEFAULT_MODEL
    });

    const fullText = assistantResult.bubbles.join("\n\n");
    const finalResult = extractFinalResult(fullText);

    setTriggerRunConversationId(run.id, assistantResult.conversationId);
    completeTriggerRun(run.id, {
      ok: true,
      finalResult,
      output: {
        bubbles: assistantResult.bubbles,
        conversationId: assistantResult.conversationId,
        finalResult
      }
    });

    const completedRun = getTriggerRun(run.id);
    if (!completedRun) {
      throw new Error("Failed to reload completed run");
    }

    return {
      run: completedRun,
      conversationId: assistantResult.conversationId,
      finalResult,
      resultPreview: previewFromRunResult(assistantResult)
    };
  } catch (error) {
    completeTriggerRun(run.id, {
      ok: false,
      error: error instanceof Error ? error.message : "Run failed"
    });
    throw error;
  }
}
