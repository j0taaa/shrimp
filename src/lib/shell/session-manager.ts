import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_TIMEOUT_MS, MAX_OUTPUT_CHARS, MAX_SESSIONS, SESSION_TTL_MS } from "@/lib/config";

type Platform = "darwin" | "linux" | "win32";

type BufferedStream = {
  offset: number;
  data: string;
};

type PendingCommand = {
  token: string;
  startedAt: number;
  stdoutStart: number;
  stderrStart: number;
};

type ActiveInteractiveCommand = {
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  stdout: BufferedStream;
  stderr: BufferedStream;
  stdoutReadAt: number;
  stderrReadAt: number;
};

type CommandCompletion = {
  exitCode: number | null;
  cwd: string;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export interface ShellSession {
  id: string;
  cwd: string;
  platform: Platform;
  shell: string;
  createdAt: number;
  lastUsedAt: number;
}

type ShellSessionInternal = ShellSession & {
  process: ChildProcessWithoutNullStreams;
  stdout: BufferedStream;
  stderr: BufferedStream;
  stdoutReadAt: number;
  stderrReadAt: number;
  pendingCommand?: PendingCommand;
  interactive?: ActiveInteractiveCommand;
};

export interface RunCommandResult {
  sessionId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
}

export interface WriteStdinResult {
  sessionId: string;
  stdout: string;
  stderr: string;
  completed?: {
    exitCode: number | null;
    cwd: string;
    durationMs: number;
  };
}

const sessions = new Map<string, ShellSessionInternal>();
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

function capStream(stream: BufferedStream) {
  const maxLen = Math.max(MAX_OUTPUT_CHARS * 2, 2000);
  if (stream.data.length <= maxLen) return;
  const drop = stream.data.length - maxLen;
  stream.data = stream.data.slice(drop);
  stream.offset += drop;
}

function appendStream(stream: BufferedStream, value: string) {
  if (!value) return;
  stream.data += value;
  capStream(stream);
}

function absolutePosition(stream: BufferedStream) {
  return stream.offset + stream.data.length;
}

function sliceStream(stream: BufferedStream, startAbs: number, endAbs?: number) {
  const end = endAbs ?? absolutePosition(stream);
  if (end <= startAbs) return "";

  const startRel = Math.max(0, startAbs - stream.offset);
  const endRel = Math.min(stream.data.length, end - stream.offset);
  if (endRel <= startRel) return "";
  return stream.data.slice(startRel, endRel);
}

function removeRangeFromStream(stream: BufferedStream, startAbs: number, endAbs: number) {
  const startRel = Math.max(0, startAbs - stream.offset);
  const endRel = Math.min(stream.data.length, endAbs - stream.offset);
  if (endRel <= startRel) return;
  stream.data = stream.data.slice(0, startRel) + stream.data.slice(endRel);
}

function trimOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(-MAX_OUTPUT_CHARS)}\n...[truncated]`;
}

function cleanupSessions() {
  const current = now();
  if (current - lastCleanup < 30_000) return;
  lastCleanup = current;

  for (const [id, session] of sessions.entries()) {
    if (current - session.lastUsedAt > SESSION_TTL_MS) {
      session.interactive?.process.kill();
      session.process.kill();
      sessions.delete(id);
    }
  }
}

function spawnShell(cwd: string, shell: string) {
  return spawn(shell, [], {
    cwd,
    env: process.env,
    stdio: "pipe"
  });
}

function createSessionInternal(cwd?: string): ShellSessionInternal {
  cleanupSessions();
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldest) {
      oldest.process.kill();
      sessions.delete(oldest.id);
    }
  }

  const platform = process.platform as Platform;
  const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();
  const shell = getDefaultShell(platform);
  const child = spawnShell(resolvedCwd, shell);

  const session: ShellSessionInternal = {
    id: randomUUID(),
    cwd: resolvedCwd,
    platform,
    shell,
    createdAt: now(),
    lastUsedAt: now(),
    process: child,
    stdout: { offset: 0, data: "" },
    stderr: { offset: 0, data: "" },
    stdoutReadAt: 0,
    stderrReadAt: 0
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    appendStream(session.stdout, String(chunk));
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    appendStream(session.stderr, String(chunk));
  });

  child.on("exit", () => {
    sessions.delete(session.id);
  });

  sessions.set(session.id, session);
  return session;
}

export function createShellSession(cwd?: string): ShellSession {
  const session = createSessionInternal(cwd);
  return {
    id: session.id,
    cwd: session.cwd,
    platform: session.platform,
    shell: session.shell,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt
  };
}

export function closeShellSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.interactive?.process.kill();
  session.process.kill();
  return sessions.delete(sessionId);
}

function getSession(sessionId?: string, cwd?: string): ShellSessionInternal {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastUsedAt = now();
    if (cwd && path.resolve(cwd) !== session.cwd) {
      session.process.kill();
      sessions.delete(session.id);
      return createSessionInternal(cwd);
    }
    return session;
  }

  return createSessionInternal(cwd);
}

function buildCommandScript(command: string, token: string, platform: Platform) {
  if (platform === "win32") {
    return `${command}\r\necho __SHRIMP_DONE_${token}:%errorlevel%:%cd%\r\n`;
  }

  return `${command}\nprintf '__SHRIMP_DONE_${token}:%s:%s\\n' "$?" "$PWD"\n`;
}

function shellArgsForCommand(platform: Platform, command: string) {
  if (platform === "win32") {
    return ["/d", "/s", "/c", command];
  }
  return ["-lc", command];
}

function activeInteractiveCompletion(
  session: ShellSessionInternal
): { exitCode: number | null; durationMs: number } | null {
  const active = session.interactive;
  if (!active) return null;
  if (active.process.exitCode === null) return null;
  return {
    exitCode: active.process.exitCode,
    durationMs: now() - active.startedAt
  };
}

async function waitForInteractiveCompletion(session: ShellSessionInternal, timeoutMs: number) {
  const started = now();
  while (now() - started < timeoutMs) {
    const completed = activeInteractiveCompletion(session);
    if (completed) return completed;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

function tryConsumePendingCompletion(session: ShellSessionInternal): CommandCompletion | null {
  const pending = session.pendingCommand;
  if (!pending) return null;

  const markerPrefix = `__SHRIMP_DONE_${pending.token}:`;
  const markerRelStart = session.stdout.data.indexOf(markerPrefix);
  if (markerRelStart === -1) return null;

  const markerRelEnd = session.stdout.data.indexOf("\n", markerRelStart);
  if (markerRelEnd === -1) return null;

  const markerLine = session.stdout.data.slice(markerRelStart, markerRelEnd).replace(/\r$/, "");
  const parsed = markerLine.match(/^__SHRIMP_DONE_[A-Za-z0-9]+:(-?\d+):(.*)$/);
  if (!parsed) return null;

  const markerStartAbs = session.stdout.offset + markerRelStart;
  const markerEndAbs = session.stdout.offset + markerRelEnd + 1;

  const stdout = sliceStream(session.stdout, pending.stdoutStart, markerStartAbs);
  const stderr = sliceStream(session.stderr, pending.stderrStart, absolutePosition(session.stderr));

  removeRangeFromStream(session.stdout, markerStartAbs, markerEndAbs);

  const completion: CommandCompletion = {
    exitCode: Number.isFinite(Number(parsed[1])) ? Number(parsed[1]) : null,
    cwd: parsed[2].trim() || session.cwd,
    durationMs: now() - pending.startedAt,
    stdout: trimOutput(stdout),
    stderr: trimOutput(stderr)
  };

  session.cwd = path.resolve(completion.cwd);
  session.pendingCommand = undefined;
  session.lastUsedAt = now();

  return completion;
}

async function waitForCompletion(session: ShellSessionInternal, timeoutMs: number) {
  const started = now();

  while (now() - started < timeoutMs) {
    const completed = tryConsumePendingCompletion(session);
    if (completed) return completed;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return null;
}

export async function runCommand(input: {
  sessionId?: string;
  command: string;
  cwd?: string;
  interactive?: boolean;
  timeoutMs?: number;
}): Promise<RunCommandResult> {
  cleanupSessions();
  const session = getSession(input.sessionId, input.cwd);
  const startedAt = now();

  if (session.pendingCommand || session.interactive) {
    return {
      sessionId: session.id,
      exitCode: null,
      stdout: "",
      stderr: "Session already has a running command. Use write_stdin to continue interacting.",
      timedOut: false,
      durationMs: now() - startedAt,
      cwd: session.cwd
    };
  }

  if (input.interactive) {
    const child = spawn(session.shell, shellArgsForCommand(session.platform, input.command), {
      cwd: session.cwd,
      env: process.env,
      stdio: "pipe"
    });

    const active: ActiveInteractiveCommand = {
      process: child,
      startedAt,
      stdout: { offset: 0, data: "" },
      stderr: { offset: 0, data: "" },
      stdoutReadAt: 0,
      stderrReadAt: 0
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      appendStream(active.stdout, String(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      appendStream(active.stderr, String(chunk));
    });

    session.interactive = active;
    session.lastUsedAt = now();

    const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const completion = await waitForInteractiveCompletion(session, timeout);
    if (!completion) {
      return {
        sessionId: session.id,
        exitCode: null,
        stdout: trimOutput(sliceStream(active.stdout, 0)),
        stderr: trimOutput(sliceStream(active.stderr, 0)),
        timedOut: true,
        durationMs: now() - startedAt,
        cwd: session.cwd
      };
    }

    session.interactive = undefined;
    return {
      sessionId: session.id,
      exitCode: completion.exitCode,
      stdout: trimOutput(sliceStream(active.stdout, 0)),
      stderr: trimOutput(sliceStream(active.stderr, 0)),
      timedOut: false,
      durationMs: completion.durationMs,
      cwd: session.cwd
    };
  }

  const token = randomUUID().replace(/-/g, "");
  session.pendingCommand = {
    token,
    startedAt,
    stdoutStart: absolutePosition(session.stdout),
    stderrStart: absolutePosition(session.stderr)
  };

  const script = buildCommandScript(input.command, token, session.platform);
  session.process.stdin.write(script);

  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const completion = await waitForCompletion(session, timeout);

  if (!completion) {
    return {
      sessionId: session.id,
      exitCode: null,
      stdout: trimOutput(sliceStream(session.stdout, session.pendingCommand?.stdoutStart ?? absolutePosition(session.stdout))),
      stderr: trimOutput(sliceStream(session.stderr, session.pendingCommand?.stderrStart ?? absolutePosition(session.stderr))),
      timedOut: true,
      durationMs: now() - startedAt,
      cwd: session.cwd
    };
  }

  return {
    sessionId: session.id,
    exitCode: completion.exitCode,
    stdout: completion.stdout,
    stderr: completion.stderr,
    timedOut: false,
    durationMs: completion.durationMs,
    cwd: completion.cwd
  };
}

export async function writeStdin(input: {
  sessionId: string;
  chars?: string;
  yieldMs?: number;
}): Promise<WriteStdinResult> {
  cleanupSessions();
  const session = sessions.get(input.sessionId);
  if (!session) {
    throw new Error(`Unknown shell session: ${input.sessionId}`);
  }

  const waitMs = Math.max(0, input.yieldMs ?? 100);

  if (session.interactive) {
    const active = session.interactive;
    if (input.chars && input.chars.length > 0) {
      active.process.stdin.write(input.chars);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    const stdoutEnd = absolutePosition(active.stdout);
    const stderrEnd = absolutePosition(active.stderr);
    const stdout = trimOutput(sliceStream(active.stdout, active.stdoutReadAt, stdoutEnd));
    const stderr = trimOutput(sliceStream(active.stderr, active.stderrReadAt, stderrEnd));
    active.stdoutReadAt = stdoutEnd;
    active.stderrReadAt = stderrEnd;

    const completion = activeInteractiveCompletion(session);
    if (completion) {
      session.interactive = undefined;
    }

    session.lastUsedAt = now();
    return {
      sessionId: session.id,
      stdout,
      stderr,
      completed: completion
        ? {
            exitCode: completion.exitCode,
            cwd: session.cwd,
            durationMs: completion.durationMs
          }
        : undefined
    };
  }

  if (input.chars && input.chars.length > 0) {
    session.process.stdin.write(input.chars);
  }
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const stdoutEnd = absolutePosition(session.stdout);
  const stderrEnd = absolutePosition(session.stderr);
  const stdout = trimOutput(sliceStream(session.stdout, session.stdoutReadAt, stdoutEnd));
  const stderr = trimOutput(sliceStream(session.stderr, session.stderrReadAt, stderrEnd));

  const completion = tryConsumePendingCompletion(session);

  session.stdoutReadAt = stdoutEnd;
  session.stderrReadAt = stderrEnd;
  session.lastUsedAt = now();

  return {
    sessionId: session.id,
    stdout,
    stderr,
    completed: completion
      ? {
          exitCode: completion.exitCode,
          cwd: completion.cwd,
          durationMs: completion.durationMs
        }
      : undefined
  };
}

export function listShellSessions() {
  cleanupSessions();
  return [...sessions.values()].map((session) => ({
    id: session.id,
    cwd: session.cwd,
    platform: session.platform,
    shell: session.shell,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt
  }));
}
