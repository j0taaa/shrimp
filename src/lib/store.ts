import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Conversation, Message, ToolCallRecord } from "@/lib/types";

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
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message["role"],
    content: row.content,
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

export function listConversations(): Conversation[] {
  const stmt = db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC");
  return stmt.all().map((row) => mapConversation(row as Record<string, string>));
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

export function setConversationTitleIfDefault(id: string, title: string) {
  db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title = 'New chat'").run(
    title,
    now(),
    id
  );
}

export function addMessage(conversationId: string, role: Message["role"], content: string): Message {
  const id = randomUUID();
  const createdAt = now();
  db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    conversationId,
    role,
    content,
    createdAt
  );
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(createdAt, conversationId);
  return { id, conversationId, role, content, createdAt };
}

export function listMessages(conversationId: string): Message[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC")
    .all(conversationId);
  return rows.map((row) => mapMessage(row as Record<string, string>));
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
  return rows.map((row) => mapToolCall(row as Record<string, string>));
}
