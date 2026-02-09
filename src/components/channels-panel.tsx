"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ChannelState = {
  running: boolean;
  connected: boolean;
  lastError?: string;
  lastMessageAt?: string;
  username?: string;
  qrDataUrl?: string;
  phoneNumber?: string;
};

type ChannelStatusPayload = {
  telegram: ChannelState;
  whatsapp: ChannelState;
};

function StateBadge({ running, connected }: { running: boolean; connected: boolean }) {
  if (connected) return <Badge className="bg-emerald-50 text-emerald-700">Connected</Badge>;
  if (running) return <Badge className="bg-amber-50 text-amber-700">Starting</Badge>;
  return <Badge className="bg-slate-100 text-slate-700">Stopped</Badge>;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ChannelsPanel() {
  const [status, setStatus] = useState<ChannelStatusPayload | null>(null);
  const [busy, setBusy] = useState<"all" | "telegram" | "whatsapp" | null>(null);

  async function fetchStatus() {
    const res = await fetch("/api/channels/status", { cache: "no-store" });
    const data = (await res.json()) as ChannelStatusPayload;
    setStatus(data);
  }

  async function start(channel: "all" | "telegram" | "whatsapp") {
    setBusy(channel);
    try {
      await fetch("/api/channels/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel })
      });
      await fetchStatus();
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void fetchStatus();
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 2500);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Telegram</CardTitle>
          <StateBadge running={Boolean(status?.telegram.running)} connected={Boolean(status?.telegram.connected)} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>Bot username:</strong> {status?.telegram.username ?? "-"}
          </p>
          <p>
            <strong>Last message:</strong> {formatDate(status?.telegram.lastMessageAt)}
          </p>
          {status?.telegram.lastError ? <p className="text-xs text-red-700">{status.telegram.lastError}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => start("telegram")} disabled={busy !== null}>
              {busy === "telegram" ? "Starting..." : "Start Telegram"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void fetchStatus()} disabled={busy !== null}>
              Refresh
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Set TELEGRAM_BOT_TOKEN in .env and start the connector.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">WhatsApp</CardTitle>
          <StateBadge running={Boolean(status?.whatsapp.running)} connected={Boolean(status?.whatsapp.connected)} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>Connected phone:</strong> {status?.whatsapp.phoneNumber ?? "-"}
          </p>
          <p>
            <strong>Last message:</strong> {formatDate(status?.whatsapp.lastMessageAt)}
          </p>
          {status?.whatsapp.lastError ? <p className="text-xs text-red-700">{status.whatsapp.lastError}</p> : null}

          {status?.whatsapp.qrDataUrl ? (
            <div className="rounded-lg border bg-white p-2">
              <p className="mb-2 text-xs text-muted-foreground">Scan this QR code using WhatsApp on the spare phone number.</p>
              <Image src={status.whatsapp.qrDataUrl} alt="WhatsApp QR code" width={220} height={220} unoptimized />
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button size="sm" onClick={() => start("whatsapp")} disabled={busy !== null}>
              {busy === "whatsapp" ? "Starting..." : "Start WhatsApp"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void fetchStatus()} disabled={busy !== null}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Quick Start</CardTitle>
          <Button size="sm" onClick={() => start("all")} disabled={busy !== null}>
            {busy === "all" ? "Starting..." : "Start All Connectors"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>1. Open this page and click Start All Connectors.</p>
          <p>2. For Telegram, message your bot after setting TELEGRAM_BOT_TOKEN.</p>
          <p>3. For WhatsApp, scan QR with the spare phone number account.</p>
          <p>4. Incoming messages from both channels are processed by the same Shrimp AI engine.</p>
        </CardContent>
      </Card>
    </div>
  );
}
