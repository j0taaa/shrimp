import { z } from "zod";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from "@/lib/config";

export const createSessionSchema = z.object({
  cwd: z.string().min(1).optional()
});

export const closeSessionSchema = z.object({
  sessionId: z.string().min(1)
});

export const runCommandSchema = z.object({
  sessionId: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS)
});

export const readFileSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(2_000_000).default(200_000)
});

export const writeFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  createIfMissing: z.boolean().default(true)
});

export const editPatchSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  newText: z.string()
});

export const editFileSchema = z.object({
  path: z.string().min(1),
  patches: z.array(editPatchSchema).min(1)
});

export const listFilesSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().default(false),
  maxEntries: z.number().int().positive().max(5000).default(500)
});

export const updateSystemPromptMemorySchema = z.object({
  memory: z.string().min(3).max(400)
});
