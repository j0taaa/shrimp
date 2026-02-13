"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  File,
  FileText,
  Menu,
  MessageSquarePlus,
  Mic,
  PanelLeftClose,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Search,
  Send,
  TerminalSquare,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import type { ChatStreamEvent, Conversation, Message, MessageAttachment, ToolCallRecord } from "@/lib/types";

interface ConversationPayload {
  conversation: Conversation;
  messages: Message[];
  toolCalls: ToolCallRecord[];
}

interface DraftBubble {
  id: string;
  text: string;
}

function compactPreview(value: string, maxChars = 90) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMessageTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isLikelyTextFile(file: File) {
  if (file.type.startsWith("text/")) return true;
  return /\.(txt|md|json|ts|tsx|js|jsx|css|html|xml|yml|yaml|log)$/i.test(file.name);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function ToolStatusBadge({ status }: { status: ToolCallRecord["status"] }) {
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Success
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        <AlertCircle className="h-3 w-3" />
        Error
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />
      Running
    </span>
  );
}

export function ChatApp() {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [assistantDraftBubbles, setAssistantDraftBubbles] = useState<DraftBubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>(["gpt-4.1-mini"]);
  const [model, setModel] = useState("gpt-4.1-mini");
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const touchStartRef = useRef<{ messageId: string; x: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setSidebarOpen(false);
  }

  async function ensureConversation() {
    if (conversationId) return conversationId;
    const res = await fetch("/api/conversations", { method: "POST" });
    const data = await res.json();
    setConversationId(data.conversation.id);
    await loadConversations();
    return data.conversation.id as string;
  }

  useEffect(() => {
    async function boot() {
      const requestedConversationId = searchParams.get("conversationId");
      const [runtimeRes, existing] = await Promise.all([fetch("/api/runtime"), loadConversations()]);
      const runtime = await runtimeRes.json();
      if (runtime.models?.allowedModels?.length) {
        setModels(runtime.models.allowedModels);
        setModel(runtime.models.defaultModel ?? runtime.models.allowedModels[0]);
      }
      if (requestedConversationId) {
        await loadConversation(requestedConversationId);
        return;
      }
      if (existing[0]) {
        await loadConversation(existing[0].id);
      }
    }

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, assistantDraftBubbles]);

  async function createNewChat() {
    const res = await fetch("/api/conversations", { method: "POST" });
    const data = await res.json();
    setConversationId(data.conversation.id);
    setMessages([]);
    setToolCalls([]);
    setAssistantDraftBubbles([]);
    setReplyToMessageId(null);
    setPendingAttachments([]);
    await loadConversations();
    setSidebarOpen(false);
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

  async function removeConversation(id: string, title: string) {
    if (!window.confirm(`Delete conversation "${title}"?`)) return;

    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete conversation.");
      return;
    }

    const updatedConversations = await loadConversations();

    if (conversationId === id) {
      const nextConversation = updatedConversations[0];
      if (nextConversation) {
        await loadConversation(nextConversation.id);
      } else {
        setConversationId(null);
        setMessages([]);
        setToolCalls([]);
        setAssistantDraftBubbles([]);
        setReplyToMessageId(null);
        setPendingAttachments([]);
      }
    }
  }

  async function fileToAttachment(file: File): Promise<MessageAttachment> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (file.type.startsWith("image/")) {
      const dataUrl = await readFileAsDataUrl(file);
      return {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        kind: "image",
        dataUrl
      };
    }

    if (isLikelyTextFile(file) && file.size <= 300_000) {
      const textContent = (await readFileAsText(file)).slice(0, 20_000);
      return {
        id,
        name: file.name,
        type: file.type || "text/plain",
        size: file.size,
        kind: "text",
        textContent
      };
    }

    return {
      id,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      kind: "binary"
    };
  }

  async function onAttachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const selected = [...files].slice(0, 6);
    const attachments = await Promise.all(selected.map((file) => fileToAttachment(file)));
    setPendingAttachments((prev) => [...prev, ...attachments]);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  async function sendMessage() {
    if ((!input.trim() && pendingAttachments.length === 0) || sending) return;

    const currentInput = input.trim() ? input : "[Attachment message]";
    const currentReplyToMessageId = replyToMessageId;
    const currentAttachments = pendingAttachments;

    setInput("");
    setReplyToMessageId(null);
    setPendingAttachments([]);
    setSending(true);
    setError(null);
    setAssistantDraftBubbles([]);

    const userMessage: Message = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? "pending",
      role: "user",
      content: currentInput,
      attachments: currentAttachments,
      replyToMessageId: currentReplyToMessageId ?? undefined,
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
          model,
          replyToMessageId: currentReplyToMessageId,
          attachments: currentAttachments
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

          if (event.type === "assistant_bubble_start") {
            setAssistantDraftBubbles((prev) => [...prev, { id: event.bubbleId, text: "" }]);
          }

          if (event.type === "token") {
            setAssistantDraftBubbles((prev) => {
              if (prev.length === 0) return [{ id: event.bubbleId ?? "draft-0", text: event.value }];

              const targetId = event.bubbleId ?? prev[prev.length - 1].id;
              const existingIndex = prev.findIndex((bubble) => bubble.id === targetId);

              if (existingIndex === -1) {
                return [...prev, { id: targetId, text: event.value }];
              }

              return prev.map((bubble, index) =>
                index === existingIndex ? { ...bubble, text: bubble.text + event.value } : bubble
              );
            });
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

          if (event.type === "assistant_done") {
            await Promise.all([loadConversations(), loadConversation(ensuredId)]);
            setAssistantDraftBubbles([]);
          }

          if (event.type === "error") {
            setError(event.error);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Unexpected stream error.");
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

  function getMessagePreview(messageId?: string | null) {
    if (!messageId) return null;
    const message = messages.find((item) => item.id === messageId);
    if (!message) return null;
    return compactPreview(message.content);
  }

  function onMessageTouchStart(messageId: string, clientX: number) {
    touchStartRef.current = { messageId, x: clientX };
  }

  function onMessageTouchEnd(clientX: number) {
    const touch = touchStartRef.current;
    if (!touch) return;

    const deltaX = clientX - touch.x;
    if (deltaX < -45) {
      setReplyToMessageId(touch.messageId);
    }

    touchStartRef.current = null;
  }

  async function editMessage(message: Message) {
    if (!conversationId) return;
    if (message.id.startsWith("local-")) return;

    const next = window.prompt("Edit message", message.content);
    if (!next || next.trim() === message.content) return;

    await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: next.trim() })
    });

    await loadConversation(conversationId);
  }

  async function removeMessage(message: Message) {
    if (!conversationId) return;
    if (message.id.startsWith("local-")) return;
    if (!window.confirm("Delete this message?")) return;

    await fetch(`/api/messages/${message.id}`, {
      method: "DELETE"
    });

    if (replyToMessageId === message.id) {
      setReplyToMessageId(null);
    }

    await loadConversation(conversationId);
  }

  function renderAttachmentList(attachments?: MessageAttachment[]) {
    if (!attachments || attachments.length === 0) return null;

    return (
      <div className="mt-2 space-y-2">
        {attachments.map((attachment) => {
          if (attachment.kind === "image" && attachment.dataUrl) {
            return (
              <div key={attachment.id} className="overflow-hidden rounded-xl border bg-white">
                <Image
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  width={600}
                  height={400}
                  unoptimized
                  className="max-h-56 w-full object-cover"
                />
                <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground">
                  <span className="truncate">{attachment.name}</span>
                  <span>{formatBytes(attachment.size)}</span>
                </div>
              </div>
            );
          }

          const Icon = attachment.kind === "text" ? FileText : File;
          return (
            <div key={attachment.id} className="flex items-center gap-2 rounded-lg border bg-[#f8f8f9] px-2 py-2 text-xs">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">{attachment.name}</p>
                <p className="text-[11px] text-muted-foreground">{formatBytes(attachment.size)}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const sortedToolCalls = useMemo(
    () => [...toolCalls].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [toolCalls]
  );

  const replyPreview = getMessagePreview(replyToMessageId);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#ececec]">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-[280px] border-r bg-[#f7f7f8] transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-4">
            <div className="text-sm font-semibold">Shrimp</div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden" onClick={() => setSidebarOpen(false)}>
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>

          <div className="px-3">
            <Button
              onClick={createNewChat}
              className="h-10 w-full justify-start gap-2 rounded-lg bg-white text-black hover:bg-white/90"
              variant="outline"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Novo chat
            </Button>
            <Button variant="ghost" className="mt-1 h-10 w-full justify-start gap-2 rounded-lg text-sm">
              <Search className="h-4 w-4" />
              Buscar em chats
            </Button>
          </div>

          <ScrollArea className="mt-3 flex-1 px-3 pb-3">
            <div className="space-y-1">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`group relative cursor-pointer rounded-lg px-2 py-2 text-sm ${
                    conversation.id === conversationId ? "bg-[#ebebeb]" : "hover:bg-[#efefef]"
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => void loadConversation(conversation.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void loadConversation(conversation.id);
                    }
                  }}
                >
                  <button
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeConversation(conversation.id, conversation.title);
                    }}
                    aria-label={`Delete ${conversation.title}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <div className="block w-full truncate text-left">{conversation.title}</div>
                  <div className="mt-1 flex items-center gap-3 pr-5">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        void renameChat(conversation.id, conversation.title);
                      }}
                    >
                      Rename
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t px-3 py-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <Link href="/settings" className="hover:text-foreground">
                Settings
              </Link>
              <Link href="/channels" className="hover:text-foreground">
                Channels
              </Link>
              <Link href="/jobs" className="hover:text-foreground">
                Jobs
              </Link>
            </div>
          </div>
        </div>
      </aside>

      {sidebarOpen ? <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setSidebarOpen(false)} /> : null}

      <main className="relative z-10 flex min-w-0 flex-1 flex-col bg-[#f7f7f8]">
        <header className="flex h-14 items-center justify-between border-b border-black/5 px-3 md:px-5">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-1 text-sm font-semibold leading-none">
              <span>{model}</span>
              <ChevronDown className="h-4 w-4" />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setToolsOpen((v) => !v)}>
              <Wrench className="mr-1 h-4 w-4" />
              Tools
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Ellipsis className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <ScrollArea className="h-full min-h-0 flex-1">
            <div className="mx-auto w-full max-w-[840px] px-4 pb-44 pt-8 md:px-8">
              {messages.length === 0 && assistantDraftBubbles.length === 0 ? (
                <div className="mt-16 text-center text-sm text-muted-foreground">
                  Start a new task and I will run tools on your computer.
                </div>
              ) : null}

              <div className="space-y-1">
                {messages.map((message) => {
                  const quoted = getMessagePreview(message.replyToMessageId);

                  return (
                    <div
                      key={message.id}
                      className={message.role === "user" ? "group relative flex justify-end" : "group relative flex justify-start"}
                      onTouchStart={(event) => onMessageTouchStart(message.id, event.touches[0].clientX)}
                      onTouchEnd={(event) => onMessageTouchEnd(event.changedTouches[0].clientX)}
                    >
                      <div className="flex max-w-[84%] items-center gap-2">
                        {message.role === "assistant" ? (
                          <div className="pointer-events-none absolute left-0 top-1 flex -translate-x-[calc(100%+8px)] flex-col gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => setReplyToMessageId(message.id)}
                            >
                              <Reply className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => void editMessage(message)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => void removeMessage(message)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : null}

                        <div
                          className={`rounded-2xl border px-3 py-2 text-sm leading-6 ${
                            message.role === "user" ? "border-[#d7d7d7] bg-[#e9e9e9]" : "border-[#ececec] bg-white"
                          }`}
                        >
                          {quoted ? (
                            <div className="mb-1 rounded-md border-l-2 border-[#4f9cf9] bg-[#f6f8fb] px-2 py-1 text-xs text-[#4b5563]">
                              {quoted}
                            </div>
                          ) : null}
                          <div className="whitespace-pre-wrap">{message.content}</div>
                          {renderAttachmentList(message.attachments)}
                          <div className="mt-1 text-right text-[10px] text-muted-foreground">
                            {formatMessageTime(message.createdAt)}
                          </div>
                        </div>

                        {message.role === "user" ? (
                          <div className="pointer-events-none absolute right-0 top-1 flex translate-x-[calc(100%+8px)] flex-col gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => setReplyToMessageId(message.id)}
                            >
                              <Reply className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => void editMessage(message)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => void removeMessage(message)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {assistantDraftBubbles.map((bubble) => (
                  <div key={bubble.id} className="flex justify-start">
                    <div className="max-w-[84%] rounded-2xl border border-[#ececec] bg-white px-3 py-2 text-sm leading-6">
                      <div className="whitespace-pre-wrap">{bubble.text}</div>
                    </div>
                  </div>
                ))}

                {sending && assistantDraftBubbles.length === 0 ? (
                  <div className="flex justify-start">
                    <div className="max-w-[84%] rounded-2xl border border-[#ececec] bg-white px-3 py-2 text-sm leading-6 text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>Thinking</span>
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:120ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:240ms]" />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div ref={threadEndRef} />
              </div>
            </div>
          </ScrollArea>

          {toolsOpen ? (
            <aside className="hidden w-[380px] border-l bg-white p-3 md:block">
              <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                <span>Tool Calls</span>
                <Badge>{sortedToolCalls.length}</Badge>
              </div>

              <ScrollArea className="h-[calc(100vh-8rem)]">
                <div className="space-y-2">
                  {sortedToolCalls.length === 0 ? (
                    <div className="rounded-lg border bg-[#fafafa] px-3 py-4 text-xs text-muted-foreground">
                      No tool calls in this conversation.
                    </div>
                  ) : null}

                  {sortedToolCalls.map((tool) => {
                    const expanded = expandedToolIds[tool.id] ?? false;
                    const preview = compactPreview(tool.result || tool.args, 120);

                    return (
                      <div key={tool.id} className="rounded-lg border bg-white p-2.5">
                        <button
                          className="flex w-full items-start justify-between gap-2 text-left"
                          onClick={() => setExpandedToolIds((prev) => ({ ...prev, [tool.id]: !expanded }))}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <TerminalSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              <p className="truncate text-xs font-semibold">{tool.name}</p>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{preview}</p>
                          </div>
                          <div className="ml-2 flex items-center gap-1">
                            <ToolStatusBadge status={tool.status} />
                            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>
                        </button>

                        {expanded ? (
                          <div className="mt-2 space-y-2 border-t pt-2">
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Input</p>
                              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-[#f6f6f7] p-2 text-[11px]">
                                {tool.args}
                              </pre>
                            </div>
                            {tool.result ? (
                              <div>
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Output</p>
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-[#f6f6f7] p-2 text-[11px]">
                                  {tool.result}
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </aside>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-5">
          <div className="mx-auto w-full max-w-[860px] px-3 md:px-5">
            <div className="pointer-events-auto overflow-hidden rounded-[26px] border bg-white shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
              {replyPreview ? (
                <div className="flex items-center justify-between border-b bg-[#f8fafc] px-4 py-2 text-xs">
                  <div className="truncate">
                    <span className="mr-1 font-medium">Replying to:</span>
                    <span className="text-muted-foreground">{replyPreview}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setReplyToMessageId(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null}

              {pendingAttachments.length > 0 ? (
                <div className="border-b px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((attachment) => (
                      <div key={attachment.id} className="relative rounded-lg border bg-[#f9f9f9] p-1.5">
                        {attachment.kind === "image" && attachment.dataUrl ? (
                          <Image
                            src={attachment.dataUrl}
                            alt={attachment.name}
                            width={160}
                            height={128}
                            unoptimized
                            className="h-16 w-20 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-16 w-20 items-center justify-center rounded bg-white text-[11px] text-muted-foreground">
                            {attachment.kind === "text" ? <FileText className="h-4 w-4" /> : <File className="h-4 w-4" />}
                          </div>
                        )}
                        <button
                          className="absolute -right-1 -top-1 rounded-full border bg-white p-0.5"
                          onClick={() => removePendingAttachment(attachment.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <p className="mt-1 w-20 truncate text-[10px]">{attachment.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-2 px-4 py-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void onAttachFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 rounded-full p-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus className="h-4 w-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 rounded-full p-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>

                <Input
                  className="h-10 border-0 bg-transparent text-sm shadow-none ring-0 focus-visible:ring-0"
                  placeholder="Type a message"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />

                <Select
                  className="hidden h-8 w-[130px] border-0 bg-transparent text-xs md:block"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {models.map((m) => (
                    <option value={m} key={m}>
                      {m}
                    </option>
                  ))}
                </Select>

                <Button variant="ghost" size="sm" className="h-8 w-8 rounded-full p-0">
                  <Mic className="h-4 w-4" />
                </Button>

                <Button
                  onClick={sending ? stopGeneration : sendMessage}
                  disabled={!sending && !input.trim() && pendingAttachments.length === 0}
                  className="h-9 w-9 rounded-full p-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {error ? <p className="mt-2 px-2 text-xs text-red-700">{error}</p> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
