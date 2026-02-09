import os from "node:os";

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

export const ALLOWED_MODELS = (process.env.OPENAI_ALLOWED_MODELS ?? "gpt-4.1-mini,gpt-4.1")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

export const DB_PATH = process.env.SHRIMP_DB_PATH ?? "./data/shrimp.db";
export const SESSION_TTL_MS = 1000 * 60 * 30;
export const MAX_SESSIONS = Number(process.env.SHRIMP_MAX_SESSIONS ?? 8);
export const DEFAULT_TIMEOUT_MS = Number(process.env.SHRIMP_COMMAND_TIMEOUT_MS ?? 30000);
export const MAX_TIMEOUT_MS = 1000 * 60 * 5;
export const MAX_OUTPUT_CHARS = Number(process.env.SHRIMP_MAX_OUTPUT_CHARS ?? 20000);

export function runtimeInfo() {
  const platform = process.platform;
  const shell =
    platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : process.env.SHELL || (platform === "darwin" ? "zsh" : "bash");

  return {
    platform,
    shell,
    hostname: os.hostname(),
    dbPath: DB_PATH
  };
}
