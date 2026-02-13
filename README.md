# Shrimp v1

Local-first computer-use agent built with Next.js, Tailwind, and shadcn-style UI primitives.

## Features

- Chat UI with streaming assistant responses.
- BYOK OpenAI integration via `OPENAI_API_KEY` in server env.
- Tool-calling loop using OpenAI Responses API.
- HTTP-first one-shot trigger API for automation runs.
- Prompt-driven two-tier project knowledge:
  - skills in `knowledge/skills/<topic>/SKILL.md`
  - facts in `knowledge/facts/<domain-or-entity>/FACTS.md`
- Host tools:
  - `run_command`
  - `create_shell_session`
  - `close_shell_session`
  - `read_file`
  - `write_file`
  - `edit_file`
  - `write_stdin`
- Persistent shell sessions with session IDs and TTL cleanup.
- Local SQLite persistence for conversations, messages, and tool calls.
- Runtime settings page with model/runtime diagnostics.
- Jobs page with API-triggered run logs and links to job conversations.

## Stack

- Next.js App Router (TypeScript)
- Tailwind CSS
- shadcn-style component structure
- SQLite (`better-sqlite3`)
- OpenAI Node SDK (`responses`)
- Vitest

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Set your OpenAI key in `.env.local`:

```env
OPENAI_API_KEY=your_key_here
```

4. Start the app:

```bash
npm run dev
```

5. Open `http://localhost:3000`.

## Environment Variables

- `OPENAI_API_KEY`: required
- `OPENAI_BASE_URL`: optional provider-compatible base URL (example: `https://api.z.ai/api/coding/paas/v4`)
- `OPENAI_MODEL`: default model (`gpt-4.1-mini`)
- `OPENAI_ALLOWED_MODELS`: comma-separated model allowlist
- `SHRIMP_DB_PATH`: sqlite DB path (`./data/shrimp.db`)
- `SHRIMP_MAX_SESSIONS`: max in-memory shell sessions
- `SHRIMP_COMMAND_TIMEOUT_MS`: default command timeout
- `SHRIMP_MAX_OUTPUT_CHARS`: max captured output per tool call

## API Endpoints

- `POST /api/chat/stream`
  - Request: `{ conversationId?: string, message: string, model?: string }`
  - SSE events: `conversation`, `token`, `tool_call_started`, `tool_call_output`, `tool_call_finished`, `assistant_done`, `error`
- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/conversations/:id`
- `PATCH /api/conversations/:id`
- `GET /api/runtime`
- `GET /api/jobs`
- `POST /api/jobs`
  - Request: `{ message: string, trigger?: "manual"|"api"|"webhook", payload?: unknown, model?: string }`

## Tests

```bash
npm run test
```

## Security Notes

This v1 runs tools without interactive approval and allows full-computer scope. Use only in trusted local environments.

Known risks in this version:

- Tool calls are not path-sandboxed.
- Command allow/deny policies are not enforced.
- No user auth boundary (single local user).

## Project Structure

- `src/app/chat` UI route
- `src/app/settings` runtime/model diagnostics
- `src/app/api/chat/stream` LLM + tools orchestration
- `src/lib/shell/session-manager.ts` shell session state + command execution
- `src/lib/tools.ts` tool schemas and implementations
- `src/lib/store.ts` sqlite persistence operations
- `knowledge/skills/` repo-local procedural knowledge skills
- `knowledge/facts/` repo-local situational facts
