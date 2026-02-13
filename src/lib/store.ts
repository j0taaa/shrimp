import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type {
  Conversation,
  ExternalChannel,
  Message,
  MessageAttachment,
  ToolCallRecord,
  TriggerRun
} from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function mapConversation(row: Record<string, string>): Conversation {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: Record<string, string>): Message {
  const attachments = row.attachments_json
    ? (JSON.parse(row.attachments_json) as MessageAttachment[])
    : undefined;

  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message["role"],
    content: row.content,
    replyToMessageId: row.reply_to_message_id ?? undefined,
    bubbleGroupId: row.bubble_group_id ?? undefined,
    attachments,
    createdAt: row.created_at
  };
}

function mapToolCall(row: Record<string, string>): ToolCallRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name as ToolCallRecord["name"],
    args: row.args,
    status: row.status as ToolCallRecord["status"],
    result: row.result ?? undefined,
    createdAt: row.created_at
  };
}

function mapTriggerRun(row: Record<string, string>): TriggerRun {
  return {
    id: row.id,
    trigger: row.trigger as TriggerRun["trigger"],
    instruction: row.instruction,
    model: row.model ?? undefined,
    status: row.status as TriggerRun["status"],
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    finalResult: row.final_result_text ?? undefined,
    error: row.error_text ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? undefined
  };
}

export function listConversations(): Conversation[] {
  const stmt = db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC");
  return stmt.all().map((row: unknown) => mapConversation(row as Record<string, string>));
}

export function getConversation(id: string): Conversation | null {
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Record<string, string> | undefined;
  return row ? mapConversation(row) : null;
}

export function createConversation(model: string, title = "New chat"): Conversation {
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, title, model, timestamp, timestamp);

  return { id, title, model, createdAt: timestamp, updatedAt: timestamp };
}

export function upsertConversation(id: string | undefined, model: string): Conversation {
  if (!id) {
    return createConversation(model);
  }

  const existing = getConversation(id);
  if (!existing) {
    return createConversation(model);
  }

  const updatedAt = now();
  db.prepare("UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?").run(model, updatedAt, id);
  return { ...existing, model, updatedAt };
}

export function renameConversation(id: string, title: string) {
  db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, now(), id);
}

export function deleteConversation(id: string) {
  const transaction = db.transaction((conversationId: string) => {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM tool_calls WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM channel_links WHERE conversation_id = ?").run(conversationId);
    const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    return result.changes > 0;
  });

  return transaction(id);
}

export function setConversationTitleIfDefault(id: string, title: string) {
  db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title = 'New chat'").run(
    title,
    now(),
    id
  );
}

export function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  options?: { replyToMessageId?: string; bubbleGroupId?: string; attachments?: MessageAttachment[] }
): Message {
  const id = randomUUID();
  const createdAt = now();
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, reply_to_message_id, bubble_group_id, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    conversationId,
    role,
    content,
    options?.replyToMessageId ?? null,
    options?.bubbleGroupId ?? null,
    options?.attachments ? JSON.stringify(options.attachments) : null,
    createdAt
  );
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(createdAt, conversationId);
  return {
    id,
    conversationId,
    role,
    content,
    replyToMessageId: options?.replyToMessageId,
    bubbleGroupId: options?.bubbleGroupId,
    attachments: options?.attachments,
    createdAt
  };
}

export function listMessages(conversationId: string): Message[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC")
    .all(conversationId);
  return rows.map((row: unknown) => mapMessage(row as Record<string, string>));
}

export function addToolCall(conversationId: string, name: ToolCallRecord["name"], args: unknown): ToolCallRecord {
  const id = randomUUID();
  const createdAt = now();
  db.prepare(
    "INSERT INTO tool_calls (id, conversation_id, name, args, status, result, created_at) VALUES (?, ?, ?, ?, 'running', NULL, ?)"
  ).run(id, conversationId, name, JSON.stringify(args), createdAt);

  return {
    id,
    conversationId,
    name,
    args: JSON.stringify(args),
    status: "running",
    createdAt
  };
}

export function completeToolCall(id: string, ok: boolean, output: unknown) {
  db.prepare("UPDATE tool_calls SET status = ?, result = ? WHERE id = ?").run(
    ok ? "success" : "error",
    JSON.stringify(output),
    id
  );
}

export function listToolCalls(conversationId: string): ToolCallRecord[] {
  const rows = db
    .prepare("SELECT * FROM tool_calls WHERE conversation_id = ? ORDER BY datetime(created_at) ASC")
    .all(conversationId);
  return rows.map((row: unknown) => mapToolCall(row as Record<string, string>));
}

export function updateMessageContent(messageId: string, content: string) {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, messageId);
}

export function deleteMessage(messageId: string) {
  db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
}

export function getOrCreateChannelConversation(
  channel: ExternalChannel,
  externalChatId: string,
  model: string
): Conversation {
  const existingLink = db
    .prepare("SELECT conversation_id FROM channel_links WHERE channel = ? AND external_chat_id = ?")
    .get(channel, externalChatId) as { conversation_id?: string } | undefined;

  if (existingLink?.conversation_id) {
    const existing = getConversation(existingLink.conversation_id);
    if (existing) return existing;
  }

  const conversation = createConversation(model, `${channel}:${externalChatId}`);
  const timestamp = now();
  db.prepare(
    "INSERT INTO channel_links (id, channel, external_chat_id, conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(randomUUID(), channel, externalChatId, conversation.id, timestamp, timestamp);

  return conversation;
}

export function createTriggerRun(input: {
  trigger: TriggerRun["trigger"];
  instruction: string;
  model?: string;
  payload?: unknown;
  conversationId?: string;
}): TriggerRun {
  const id = randomUUID();
  const createdAt = now();

  db.prepare(
    "INSERT INTO trigger_runs (id, trigger, instruction, model, payload_json, status, result_json, final_result_text, error_text, conversation_id, created_at, finished_at) VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL, NULL, ?, ?, NULL)"
  ).run(
    id,
    input.trigger,
    input.instruction,
    input.model ?? null,
    input.payload === undefined ? null : JSON.stringify(input.payload),
    input.conversationId ?? null,
    createdAt
  );

  return {
    id,
    trigger: input.trigger,
    instruction: input.instruction,
    model: input.model,
    status: "running",
    payload: input.payload,
    conversationId: input.conversationId,
    createdAt
  };
}

export function completeTriggerRun(
  runId: string,
  result: { ok: true; output: unknown; finalResult?: string } | { ok: false; error: string }
) {
  const finishedAt = now();

  if (result.ok) {
    db.prepare(
      "UPDATE trigger_runs SET status = 'success', result_json = ?, final_result_text = ?, error_text = NULL, finished_at = ? WHERE id = ?"
    ).run(JSON.stringify(result.output), result.finalResult ?? null, finishedAt, runId);
    return;
  }

  db.prepare("UPDATE trigger_runs SET status = 'error', final_result_text = NULL, error_text = ?, finished_at = ? WHERE id = ?").run(
    result.error,
    finishedAt,
    runId
  );
}

export function setTriggerRunConversationId(runId: string, conversationId: string) {
  db.prepare("UPDATE trigger_runs SET conversation_id = ? WHERE id = ?").run(conversationId, runId);
}

export function listTriggerRuns(limit = 100): TriggerRun[] {
  const rows = db
    .prepare("SELECT * FROM trigger_runs ORDER BY datetime(created_at) DESC LIMIT ?")
    .all(limit);
  return rows.map((row: unknown) => mapTriggerRun(row as Record<string, string>));
}

export function getTriggerRun(runId: string): TriggerRun | null {
  const row = db.prepare("SELECT * FROM trigger_runs WHERE id = ?").get(runId) as Record<string, string> | undefined;
  return row ? mapTriggerRun(row) : null;
}
