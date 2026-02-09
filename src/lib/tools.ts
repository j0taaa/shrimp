import fs from "node:fs";
import path from "node:path";
import {
  closeSessionSchema,
  createSessionSchema,
  editFileSchema,
  listFilesSchema,
  readFileSchema,
  runCommandSchema,
  updateSystemPromptMemorySchema,
  writeFileSchema
} from "@/lib/validation";
import { closeShellSession, createShellSession, runCommand } from "@/lib/shell/session-manager";
import {
  addSystemPromptMemory,
  clearSystemPromptMemory,
  listSystemPromptMemory
} from "@/lib/system-prompt";
import type { ToolName } from "@/lib/types";

function safeStat(filePath: string) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function applyPatches(content: string, patches: Array<{ startLine: number; endLine: number; newText: string }>) {
  const lines = content.split("\n");
  const sorted = [...patches].sort((a, b) => b.startLine - a.startLine);

  for (const patch of sorted) {
    const start = patch.startLine - 1;
    const end = patch.endLine;
    lines.splice(start, end - start, ...patch.newText.split("\n"));
  }

  return lines.join("\n");
}

function walkFiles(root: string, recursive: boolean, maxEntries: number) {
  const results: Array<{ path: string; type: "file" | "dir"; size?: number }> = [];

  const queue = [root];

  while (queue.length > 0 && results.length < maxEntries) {
    const current = queue.shift()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      const absolute = path.join(current, entry.name);
      const stat = safeStat(absolute);
      if (!stat) continue;

      if (entry.isDirectory()) {
        results.push({ path: absolute, type: "dir" });
        if (recursive) queue.push(absolute);
      } else {
        results.push({ path: absolute, type: "file", size: stat.size });
      }
    }
  }

  return results;
}

export const toolDefinitions = [
  {
    type: "function",
    name: "run_command",
    description: "Run a shell command on the host computer.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        command: { type: "string" },
        cwd: { type: "string" },
        timeoutMs: { type: "number" }
      },
      required: ["command"]
    }
  },
  {
    type: "function",
    name: "create_shell_session",
    description: "Create a new shell session.",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string" }
      }
    }
  },
  {
    type: "function",
    name: "close_shell_session",
    description: "Close a shell session by id.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      },
      required: ["sessionId"]
    }
  },
  {
    type: "function",
    name: "read_file",
    description: "Read file contents from disk.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxBytes: { type: "number" }
      },
      required: ["path"]
    }
  },
  {
    type: "function",
    name: "write_file",
    description: "Write full file content to disk.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        createIfMissing: { type: "boolean" }
      },
      required: ["path", "content"]
    }
  },
  {
    type: "function",
    name: "edit_file",
    description: "Apply line-range patches to a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              startLine: { type: "number" },
              endLine: { type: "number" },
              newText: { type: "string" }
            },
            required: ["startLine", "endLine", "newText"]
          }
        }
      },
      required: ["path", "patches"]
    }
  },
  {
    type: "function",
    name: "list_files",
    description: "List files and directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
        maxEntries: { type: "number" }
      },
      required: ["path"]
    }
  },
  {
    type: "function",
    name: "update_system_prompt_memory",
    description:
      "Store a durable user preference or profile detail to be remembered across future conversations.",
    parameters: {
      type: "object",
      properties: {
        memory: { type: "string" }
      },
      required: ["memory"]
    }
  },
  {
    type: "function",
    name: "list_system_prompt_memory",
    description: "List currently stored persistent memory facts.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "clear_system_prompt_memory",
    description: "Clear all persistent memory facts.",
    parameters: {
      type: "object",
      properties: {}
    }
  }
] as const;

export async function runTool(name: ToolName, rawArgs: unknown): Promise<unknown> {
  switch (name) {
    case "run_command": {
      const args = runCommandSchema.parse(rawArgs);
      return runCommand(args);
    }
    case "create_shell_session": {
      const args = createSessionSchema.parse(rawArgs);
      const session = createShellSession(args.cwd);
      return { sessionId: session.id, shell: session.shell, os: session.platform, cwd: session.cwd };
    }
    case "close_shell_session": {
      const args = closeSessionSchema.parse(rawArgs);
      return { closed: closeShellSession(args.sessionId) };
    }
    case "read_file": {
      const args = readFileSchema.parse(rawArgs);
      const absolute = path.resolve(args.path);
      const buffer = fs.readFileSync(absolute);
      const sliced = buffer.subarray(0, args.maxBytes);
      return { path: absolute, content: sliced.toString("utf8"), truncated: buffer.byteLength > args.maxBytes };
    }
    case "write_file": {
      const args = writeFileSchema.parse(rawArgs);
      const absolute = path.resolve(args.path);
      if (!args.createIfMissing && !fs.existsSync(absolute)) {
        throw new Error("File does not exist and createIfMissing=false");
      }
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, args.content, "utf8");
      return { path: absolute, bytesWritten: Buffer.byteLength(args.content) };
    }
    case "edit_file": {
      const args = editFileSchema.parse(rawArgs);
      const absolute = path.resolve(args.path);
      const current = fs.readFileSync(absolute, "utf8");
      const next = applyPatches(current, args.patches);
      fs.writeFileSync(absolute, next, "utf8");
      return { path: absolute, applied: true, hunksApplied: args.patches.length };
    }
    case "list_files": {
      const args = listFilesSchema.parse(rawArgs);
      const absolute = path.resolve(args.path);
      return { entries: walkFiles(absolute, args.recursive, args.maxEntries) };
    }
    case "update_system_prompt_memory": {
      const args = updateSystemPromptMemorySchema.parse(rawArgs);
      return addSystemPromptMemory(args.memory);
    }
    case "list_system_prompt_memory": {
      return { items: listSystemPromptMemory() };
    }
    case "clear_system_prompt_memory": {
      return clearSystemPromptMemory();
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
