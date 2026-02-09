"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RuntimePayload = {
  db: {
    status: string;
  };
  runtime: {
    platform: string;
    shell: string;
    hostname: string;
    dbPath: string;
  };
  models: {
    defaultModel: string;
    allowedModels: string[];
  };
  shellSessions: Array<{
    id: string;
    cwd: string;
    shell: string;
    platform: string;
    lastUsedAt: number;
  }>;
};

export function SettingsPanel() {
  const [data, setData] = useState<RuntimePayload | null>(null);

  useEffect(() => {
    fetch("/api/runtime")
      .then((res) => res.json())
      .then((payload) => setData(payload));
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runtime</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <strong>Platform:</strong> {data?.runtime.platform ?? "..."}
          </p>
          <p>
            <strong>Shell:</strong> {data?.runtime.shell ?? "..."}
          </p>
          <p>
            <strong>Host:</strong> {data?.runtime.hostname ?? "..."}
          </p>
          <p>
            <strong>DB:</strong> {data?.runtime.dbPath ?? "..."}
          </p>
          <p>
            <strong>DB Status:</strong> {data?.db.status ?? "..."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Models</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <strong>Default:</strong> {data?.models.defaultModel ?? "..."}
          </p>
          <p>
            <strong>Allowed:</strong> {(data?.models.allowedModels ?? []).join(", ") || "..."}
          </p>
          <p className="text-xs text-muted-foreground">
            Configure OPENAI_API_KEY, OPENAI_MODEL and OPENAI_ALLOWED_MODELS in .env.local.
          </p>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Active Shell Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data?.shellSessions?.length ? (
            data.shellSessions.map((session) => (
              <div key={session.id} className="rounded-md border p-2">
                <p>
                  <strong>ID:</strong> {session.id}
                </p>
                <p>
                  <strong>CWD:</strong> {session.cwd}
                </p>
                <p>
                  <strong>Shell:</strong> {session.shell}
                </p>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No active sessions.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
