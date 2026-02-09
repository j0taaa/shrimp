import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import TelegramBot from "node-telegram-bot-api";
import { Client as WhatsAppClient, LocalAuth } from "whatsapp-web.js";
import { DEFAULT_MODEL } from "@/lib/config";
import { runAssistantTurn } from "@/lib/assistant";
import { getOrCreateChannelConversation } from "@/lib/store";

type ChannelState = {
  running: boolean;
  connected: boolean;
  lastError?: string;
  lastMessageAt?: string;
};

type TelegramState = ChannelState & {
  username?: string;
};

type WhatsAppState = ChannelState & {
  qrDataUrl?: string;
  phoneNumber?: string;
};

type ChannelManagerState = {
  telegram: TelegramState;
  whatsapp: WhatsAppState;
};

type GlobalWithChannels = typeof globalThis & {
  __shrimpChannels?: {
    state: ChannelManagerState;
    telegramBot?: TelegramBot;
    whatsappClient?: WhatsAppClient;
    telegramStartPromise?: Promise<void>;
    whatsappStartPromise?: Promise<void>;
  };
};

const globalChannels = globalThis as GlobalWithChannels;

if (!globalChannels.__shrimpChannels) {
  globalChannels.__shrimpChannels = {
    state: {
      telegram: { running: false, connected: false },
      whatsapp: { running: false, connected: false }
    }
  };
}

const channelStore = globalChannels.__shrimpChannels;

function setTelegramState(patch: Partial<TelegramState>) {
  channelStore.state.telegram = { ...channelStore.state.telegram, ...patch };
}

function setWhatsAppState(patch: Partial<WhatsAppState>) {
  channelStore.state.whatsapp = { ...channelStore.state.whatsapp, ...patch };
}

async function handleIncomingChannelMessage(channel: "telegram" | "whatsapp", externalChatId: string, text: string) {
  const baseConversation = getOrCreateChannelConversation(channel, externalChatId, DEFAULT_MODEL);
  return runAssistantTurn({
    conversationId: baseConversation.id,
    message: text,
    model: DEFAULT_MODEL
  });
}

export async function startTelegram() {
  if (channelStore.telegramStartPromise) {
    await channelStore.telegramStartPromise;
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    setTelegramState({
      running: false,
      connected: false,
      lastError: "TELEGRAM_BOT_TOKEN is not configured"
    });
    return;
  }

  channelStore.telegramStartPromise = (async () => {
    try {
      if (!channelStore.telegramBot) {
        channelStore.telegramBot = new TelegramBot(token, { polling: true });
      }

      const bot = channelStore.telegramBot;
      const me = await bot.getMe();
      setTelegramState({
        running: true,
        connected: true,
        username: me.username,
        lastError: undefined
      });

      bot.removeAllListeners("message");
      bot.on("message", async (message: TelegramBot.Message) => {
        try {
          if (!message.chat?.id) return;
          if (!message.text || !message.text.trim()) return;

          const externalChatId = String(message.chat.id);
          const result = await handleIncomingChannelMessage("telegram", externalChatId, message.text);

          for (const bubble of result.bubbles) {
            await bot.sendMessage(message.chat.id, bubble);
          }

          setTelegramState({ lastMessageAt: new Date().toISOString() });
        } catch (error) {
          setTelegramState({
            connected: true,
            lastError: error instanceof Error ? error.message : "Telegram message processing failed"
          });
        }
      });
    } catch (error) {
      setTelegramState({
        running: false,
        connected: false,
        lastError: error instanceof Error ? error.message : "Telegram start failed"
      });
    }
  })();

  await channelStore.telegramStartPromise;
}

export async function startWhatsApp() {
  if (channelStore.whatsappStartPromise) {
    await channelStore.whatsappStartPromise;
    return;
  }

  channelStore.whatsappStartPromise = (async () => {
    try {
      if (!channelStore.whatsappClient) {
        channelStore.whatsappClient = new WhatsAppClient({
          authStrategy: new LocalAuth({ clientId: "shrimp" }),
          puppeteer: {
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
          }
        });
      }

      const client = channelStore.whatsappClient;

      client.removeAllListeners();

      client.on("qr", async (qr) => {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          setWhatsAppState({
            running: true,
            connected: false,
            qrDataUrl,
            lastError: undefined
          });
        } catch (error) {
          setWhatsAppState({
            running: true,
            connected: false,
            lastError: error instanceof Error ? error.message : "Failed to generate QR"
          });
        }
      });

      client.on("ready", async () => {
        try {
          const info = client.info;
          setWhatsAppState({
            running: true,
            connected: true,
            qrDataUrl: undefined,
            phoneNumber: info?.wid?.user,
            lastError: undefined
          });
        } catch {
          setWhatsAppState({
            running: true,
            connected: true,
            qrDataUrl: undefined,
            lastError: undefined
          });
        }
      });

      client.on("disconnected", (reason) => {
        setWhatsAppState({
          running: true,
          connected: false,
          lastError: `Disconnected: ${reason}`
        });
      });

      client.on("message", async (message) => {
        try {
          if (message.fromMe) return;
          if (!message.body?.trim()) return;

          const externalChatId = message.from;
          const result = await handleIncomingChannelMessage("whatsapp", externalChatId, message.body);

          for (const bubble of result.bubbles) {
            await client.sendMessage(message.from, bubble);
          }

          setWhatsAppState({ lastMessageAt: new Date().toISOString() });
        } catch (error) {
          setWhatsAppState({
            connected: true,
            lastError: error instanceof Error ? error.message : "WhatsApp message processing failed"
          });
        }
      });

      setWhatsAppState({ running: true, connected: false, lastError: undefined });
      await client.initialize();
    } catch (error) {
      setWhatsAppState({
        running: false,
        connected: false,
        lastError: error instanceof Error ? error.message : "WhatsApp start failed"
      });
    }
  })();

  await channelStore.whatsappStartPromise;
}

export async function startChannels(channel: "telegram" | "whatsapp" | "all") {
  if (channel === "telegram") {
    await startTelegram();
    return;
  }

  if (channel === "whatsapp") {
    await startWhatsApp();
    return;
  }

  await Promise.all([startTelegram(), startWhatsApp()]);
}

export function getChannelsStatus() {
  return {
    sessionId: randomUUID(),
    telegram: channelStore.state.telegram,
    whatsapp: channelStore.state.whatsapp
  };
}
