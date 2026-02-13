import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "@/lib/config";

const absolutePath = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH);
fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

export const db = new Database(absolutePath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  args TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_links (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_chat_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel, external_chat_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trigger_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  instruction TEXT NOT NULL,
  model TEXT,
  payload_json TEXT,
  status TEXT NOT NULL,
  result_json TEXT,
  final_result_text TEXT,
  error_text TEXT,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_links_conversation ON channel_links(conversation_id);
CREATE INDEX IF NOT EXISTS idx_trigger_runs_created_at ON trigger_runs(created_at DESC);
`);

const messageColumns = db
  .prepare("PRAGMA table_info(messages)")
  .all() as Array<{ name: string }>;

const hasReplyTo = messageColumns.some((column) => column.name === "reply_to_message_id");
if (!hasReplyTo) {
  db.exec("ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT");
}

const hasBubbleGroup = messageColumns.some((column) => column.name === "bubble_group_id");
if (!hasBubbleGroup) {
  db.exec("ALTER TABLE messages ADD COLUMN bubble_group_id TEXT");
}

const hasAttachmentsJson = messageColumns.some((column) => column.name === "attachments_json");
if (!hasAttachmentsJson) {
  db.exec("ALTER TABLE messages ADD COLUMN attachments_json TEXT");
}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_bubble_group ON messages(bubble_group_id, created_at);
`);

const triggerRunColumns = db
  .prepare("PRAGMA table_info(trigger_runs)")
  .all() as Array<{ name: string }>;

const hasFinalResultText = triggerRunColumns.some((column) => column.name === "final_result_text");
if (!hasFinalResultText) {
  db.exec("ALTER TABLE trigger_runs ADD COLUMN final_result_text TEXT");
}
