"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import type { ChatStreamEvent, Conversation, Message, ToolCallRecord } from "@/lib/types";

interface ConversationPayload {
  conversation: Conversation;
  messages: Message[];
  toolCalls: ToolCallRecord[];
}

export function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>(["gpt-4.1-mini"]);
  const [model, setModel] = useState("gpt-4.1-mini");
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  async function loadConversations() {
    const res = await fetch("/api/conversations");
    const data = await res.json();
    setConversations(data.conversations ?? []);
    return data.conversations as Conversation[];
  }

  async function loadConversation(id: string) {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as ConversationPayload;
    setConversationId(id);
    setMessages(data.messages);
    setToolCalls(data.toolCalls);
  }

  async function ensureConversation() {
    if (conversationId) return conversationId;
    const res = await fetch("/api/conversations", { method: "POST" });
    const data = await res.json();
    setConversationId(data.conversation.id);
    await loadConversations();
    return data.conversation.id as string;
  }

  async function boot() {
    const [runtimeRes, existing] = await Promise.all([fetch("/api/runtime"), loadConversations()]);
    const runtime = await runtimeRes.json();
    if (runtime.models?.allowedModels?.length) {
      setModels(runtime.models.allowedModels);
      setModel(runtime.models.defaultModel ?? runtime.models.allowedModels[0]);
    }
    if (existing[0]) {
      await loadConversation(existing[0].id);
    }
  }

  useEffect(() => {
    void boot();
  }, []);

  async function createNewChat() {
    const res = await fetch("/api/conversations", { method: "POST" });
    const data = await res.json();
    setConversationId(data.conversation.id);
    setMessages([]);
    setToolCalls([]);
    setAssistantDraft("");
    await loadConversations();
  }

  async function renameChat(id: string, currentTitle: string) {
    const nextTitle = window.prompt("Rename conversation", currentTitle);
    if (!nextTitle || nextTitle.trim() === currentTitle) return;

    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle.trim() })
    });
    await loadConversations();
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;

    const currentInput = input;
    setInput("");
    setSending(true);
    setError(null);
    setAssistantDraft("");

    const userMessage: Message = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? "pending",
      role: "user",
      content: currentInput,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMessage]);

    const ensuredId = await ensureConversation();

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: ensuredId,
          message: currentInput,
          model
        })
      });

      if (!res.ok || !res.body) {
        setError("Failed to connect to chat stream.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;

          const payload = line.replace(/^data: /, "").trim();
          if (payload === "[DONE]") continue;

          const event = JSON.parse(payload) as ChatStreamEvent;
          if (event.type === "conversation") {
            setConversationId(event.conversationId);
          }
          if (event.type === "token") {
            setAssistantDraft((prev) => prev + event.value);
          }
          if (event.type === "tool_call_started") {
            setToolCalls((prev) => [
              ...prev,
              {
                id: event.id,
                conversationId: ensuredId,
                name: event.name,
                args: JSON.stringify(event.input),
                status: "running",
                createdAt: new Date().toISOString()
              }
            ]);
          }
          if (event.type === "tool_call_finished") {
            setToolCalls((prev) =>
              prev.map((item) =>
                item.id === event.id
                  ? { ...item, status: event.ok ? "success" : "error", result: JSON.stringify(event.output) }
                  : item
              )
            );
          }
          if (event.type === "tool_call_output") {
            setToolCalls((prev) =>
              prev.map((item) =>
                item.id === event.id
                  ? { ...item, result: `${item.result ?? ""}${item.result ? "\n" : ""}${event.chunk}` }
                  : item
              )
            );
          }
          if (event.type === "error") {
            setError(event.error);
          }
        }
      }

      await Promise.all([loadConversations(), loadConversation(ensuredId)]);
      setAssistantDraft("");
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setError(error instanceof Error ? error.message : "Unexpected stream error.");
      }
    } finally {
      setSending(false);
      setAbortController(null);
    }
  }

  function stopGeneration() {
    abortController?.abort();
    setSending(false);
    setAbortController(null);
  }

  const sortedToolCalls = useMemo(
    () => [...toolCalls].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [toolCalls]
  );

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Card className="h-[calc(100vh-10rem)]">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Conversations</CardTitle>
          <Button size="sm" onClick={createNewChat}>
            New
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-16rem)] space-y-2">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`mb-2 rounded-md border p-2 text-sm ${
                  conversation.id === conversationId ? "bg-muted" : "bg-background"
                }`}
              >
                <button className="w-full text-left" onClick={() => loadConversation(conversation.id)}>
                  <div className="truncate font-medium">{conversation.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{conversation.model}</div>
                </button>
                <div className="mt-1 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => renameChat(conversation.id, conversation.title)}
                  >
                    Rename
                  </Button>
                </div>
              </div>
            ))}
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        <Card className="h-[calc(100vh-10rem)]">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Chat</CardTitle>
              <div className="w-52">
                <Select value={model} onChange={(event) => setModel(event.target.value)}>
                  {models.map((m) => (
                    <option value={m} key={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex h-[calc(100%-6rem)] flex-col gap-3">
            <ScrollArea className="flex-1 rounded-md border p-3">
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                {assistantDraft && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm">{assistantDraft}</div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Input
                placeholder="Ask Shrimp to do something on your computer..."
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <Button onClick={sendMessage} disabled={sending || !input.trim()}>
                {sending ? "Running" : "Send"}
              </Button>
              <Button variant="outline" onClick={stopGeneration} disabled={!sending}>
                Stop
              </Button>
            </div>
            {error ? <p className="text-xs text-red-700">{error}</p> : null}
          </CardContent>
        </Card>

        <Card className="h-[calc(100vh-10rem)]">
          <CardHeader>
            <CardTitle className="text-base">Tool Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[calc(100vh-16rem)] space-y-2">
              {sortedToolCalls.map((tool) => (
                <div key={tool.id} className="mb-2 rounded-md border p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">{tool.name}</span>
                    <Badge>{tool.status}</Badge>
                  </div>
                  <pre className="overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">{tool.args}</pre>
                  {tool.result ? (
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">{tool.result}</pre>
                  ) : null}
                </div>
              ))}
              {sortedToolCalls.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tool calls yet.</p>
              ) : null}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
