import fs from "node:fs";
import path from "node:path";

const MEMORY_PATH = path.join(process.cwd(), "data", "system-prompt-memory.json");
const MAX_MEMORY_ITEMS = 120;
const MAX_ITEM_LENGTH = 400;

const BASE_SYSTEM_PROMPT = `You are Shrimp, a local computer assistant.

Style and format requirements:
- Write in a friendly WhatsApp-like chat style.
- Keep messages concise and split your answer into multiple short bubbles whenever natural.
- Prefer 1-3 short sentences per bubble.
- Separate bubbles with a blank line.
- Avoid markdown lists unless explicitly asked.
- If the user is replying to a previous message, acknowledge that context naturally in your first bubble.

Tool behavior requirements:
- Use tools when the user asks for actions on files, terminal, or system state.
- After tool usage, summarize outcome clearly and mention relevant paths/outputs.
- Never claim a tool action happened unless a tool result confirms it.

Memory behavior requirements:
- If the user asks you to remember a preference or profile detail for future conversations, call update_system_prompt_memory.
- Save only durable user preferences or identity details useful in future chats.
- Do not store secrets, private keys, passwords, or sensitive personal data.`;

type MemoryStore = {
  items: string[];
};

function ensureMemoryDir() {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
}

function defaultStore(): MemoryStore {
  return { items: [] };
}

function readStore(): MemoryStore {
  ensureMemoryDir();
  if (!fs.existsSync(MEMORY_PATH)) return defaultStore();

  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8")) as MemoryStore;
    if (!Array.isArray(parsed.items)) return defaultStore();
    return {
      items: parsed.items
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(-MAX_MEMORY_ITEMS)
    };
  } catch {
    return defaultStore();
  }
}

function writeStore(store: MemoryStore) {
  ensureMemoryDir();
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(store, null, 2), "utf8");
}

export function listSystemPromptMemory() {
  return readStore().items;
}

export function addSystemPromptMemory(memory: string) {
  const normalized = memory.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LENGTH);
  if (!normalized) {
    throw new Error("memory is empty");
  }

  const store = readStore();
  if (!store.items.includes(normalized)) {
    store.items.push(normalized);
    if (store.items.length > MAX_MEMORY_ITEMS) {
      store.items = store.items.slice(-MAX_MEMORY_ITEMS);
    }
    writeStore(store);
  }

  return {
    stored: normalized,
    total: store.items.length
  };
}

export function clearSystemPromptMemory() {
  writeStore(defaultStore());
  return { cleared: true };
}

export function buildSystemPrompt() {
  const memories = listSystemPromptMemory();
  if (memories.length === 0) {
    return BASE_SYSTEM_PROMPT;
  }

  const memoryBlock = memories.map((item, index) => `${index + 1}. ${item}`).join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\nPersistent memory (apply across conversations):\n${memoryBlock}`;
}
