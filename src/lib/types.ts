export type MessageRole = "user" | "assistant" | "system";

export type ToolName =
  | "run_command"
  | "create_shell_session"
  | "close_shell_session"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "write_stdin"
  | "update_system_prompt_memory"
  | "list_system_prompt_memory";

export interface Conversation {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  replyToMessageId?: string;
  bubbleGroupId?: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface MessageAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "text" | "binary";
  dataUrl?: string;
  textContent?: string;
}

export type ExternalChannel = "telegram" | "whatsapp";

export interface ToolCallRecord {
  id: string;
  conversationId: string;
  name: ToolName;
  args: string;
  status: "running" | "success" | "error";
  result?: string;
  createdAt: string;
}

export interface TriggerRun {
  id: string;
  trigger: "manual" | "api" | "webhook";
  instruction: string;
  model?: string;
  status: "running" | "success" | "error";
  payload?: unknown;
  result?: unknown;
  finalResult?: string;
  error?: string;
  conversationId?: string;
  createdAt: string;
  finishedAt?: string;
}

export type ChatStreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "assistant_bubble_start"; bubbleId: string }
  | { type: "token"; value: string; bubbleId?: string }
  | { type: "tool_call_started"; id: string; name: ToolName; input: unknown }
  | { type: "tool_call_output"; id: string; name: ToolName; chunk: string }
  | { type: "tool_call_finished"; id: string; name: ToolName; output: unknown; ok: boolean }
  | { type: "assistant_done"; messageIds: string[] }
  | { type: "error"; error: string };
