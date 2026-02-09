export type MessageRole = "user" | "assistant" | "system";

export type ToolName =
  | "run_command"
  | "create_shell_session"
  | "close_shell_session"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "list_files";

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
  createdAt: string;
}

export interface ToolCallRecord {
  id: string;
  conversationId: string;
  name: ToolName;
  args: string;
  status: "running" | "success" | "error";
  result?: string;
  createdAt: string;
}

export type ChatStreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; value: string }
  | { type: "tool_call_started"; id: string; name: ToolName; input: unknown }
  | { type: "tool_call_output"; id: string; name: ToolName; chunk: string }
  | { type: "tool_call_finished"; id: string; name: ToolName; output: unknown; ok: boolean }
  | { type: "assistant_done"; messageId: string }
  | { type: "error"; error: string };
