import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_TIMEOUT_MS, MAX_OUTPUT_CHARS, MAX_SESSIONS, SESSION_TTL_MS } from "@/lib/config";

const execAsync = promisify(exec);

type Platform = "darwin" | "linux" | "win32";

export interface ShellSession {
  id: string;
  cwd: string;
  platform: Platform;
  shell: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface RunCommandResult {
  sessionId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
}

const sessions = new Map<string, ShellSession>();
let lastCleanup = 0;

function now() {
  return Date.now();
}

function getDefaultShell(platform: Platform) {
  if (platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || (platform === "darwin" ? "zsh" : "bash");
}

function cleanupSessions() {
  const current = now();
  if (current - lastCleanup < 30_000) return;
  lastCleanup = current;

  for (const [id, session] of sessions.entries()) {
    if (current - session.lastUsedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

function createSessionInternal(cwd?: string): ShellSession {
  cleanupSessions();
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldest) sessions.delete(oldest.id);
  }

  const platform = process.platform as Platform;
  const session: ShellSession = {
    id: randomUUID(),
    cwd: cwd ? path.resolve(cwd) : process.cwd(),
    platform,
    shell: getDefaultShell(platform),
    createdAt: now(),
    lastUsedAt: now()
  };

  sessions.set(session.id, session);
  return session;
}

export function createShellSession(cwd?: string) {
  return createSessionInternal(cwd);
}

export function closeShellSession(sessionId: string) {
  return sessions.delete(sessionId);
}

function getSession(sessionId?: string, cwd?: string): ShellSession {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    if (cwd) session.cwd = path.resolve(cwd);
    session.lastUsedAt = now();
    return session;
  }

  const session = createSessionInternal(cwd);
  return session;
}

function trimOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`;
}

function parseCd(command: string): string | null {
  const match = command.match(/^\s*cd(?:\s+(.+))?\s*$/);
  if (!match) return null;
  if (!match[1]) return "~";
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

export async function runCommand(input: {
  sessionId?: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<RunCommandResult> {
  cleanupSessions();
  const session = getSession(input.sessionId, input.cwd);

  const cdArg = parseCd(input.command);
  const startedAt = now();

  if (cdArg) {
    const nextCwd =
      cdArg === "~" ? (process.env.HOME ?? process.env.USERPROFILE ?? session.cwd) : path.resolve(session.cwd, cdArg);
    try {
      if (!path.isAbsolute(nextCwd)) {
        throw new Error("Resolved path is not absolute.");
      }
      const stat = path.isAbsolute(nextCwd) ? fs.statSync(nextCwd) : null;
      if (!stat || !stat.isDirectory()) {
        throw new Error("Target is not a directory.");
      }
    } catch {
      return {
        sessionId: session.id,
        exitCode: 1,
        stdout: "",
        stderr: `cd: no such directory: ${cdArg}`,
        timedOut: false,
        durationMs: now() - startedAt,
        cwd: session.cwd
      };
    }
    session.cwd = nextCwd;
    session.lastUsedAt = now();
    return {
      sessionId: session.id,
      exitCode: 0,
      stdout: session.cwd,
      stderr: "",
      timedOut: false,
      durationMs: now() - startedAt,
      cwd: session.cwd
    };
  }

  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const { stdout, stderr } = await execAsync(input.command, {
      cwd: session.cwd,
      shell: session.shell,
      timeout,
      maxBuffer: 1024 * 1024 * 10
    });

    session.lastUsedAt = now();

    return {
      sessionId: session.id,
      exitCode: 0,
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
      timedOut: false,
      durationMs: now() - startedAt,
      cwd: session.cwd
    };
  } catch (error) {
    const err = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };

    session.lastUsedAt = now();

    return {
      sessionId: session.id,
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: trimOutput(err.stdout ?? ""),
      stderr: trimOutput(err.stderr ?? err.message),
      timedOut: err.killed === true || err.signal === "SIGTERM",
      durationMs: now() - startedAt,
      cwd: session.cwd
    };
  }
}

export function listShellSessions() {
  cleanupSessions();
  return [...sessions.values()];
}
