"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TriggerRun } from "@/lib/types";

type JobsPayload = { runs: TriggerRun[] };

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function previewResult(run: TriggerRun) {
  if (!run.result || typeof run.result !== "object") return "-";
  const maybeResult = run.result as { bubbles?: unknown };
  if (!Array.isArray(maybeResult.bubbles)) return "-";
  const first = maybeResult.bubbles.find((item) => typeof item === "string") as string | undefined;
  return first ? (first.length > 120 ? `${first.slice(0, 120)}...` : first) : "-";
}

export function JobsPanel() {
  const [runs, setRuns] = useState<TriggerRun[]>([]);
  const [message, setMessage] = useState("");
  const [model, setModel] = useState("");
  const [trigger, setTrigger] = useState<TriggerRun["trigger"]>("manual");
  const [payloadJson, setPayloadJson] = useState("{}");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useMemo(() => runs[0], [runs]);

  async function loadRuns() {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    const data = (await res.json()) as JobsPayload;
    setRuns(data.runs ?? []);
  }

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => {
      void loadRuns();
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  async function createJob() {
    setError(null);
    setSubmitting(true);

    try {
      const payload = payloadJson.trim() ? JSON.parse(payloadJson) : undefined;
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          trigger,
          model: model.trim() || undefined,
          payload
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create job");
      }

      setMessage("");
      setPayloadJson("{}");
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Job</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">UI wrapper for `POST /api/jobs`.</p>
          <textarea
            className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2"
            placeholder="Job message/instruction..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <input
            className="h-9 w-full rounded-md border bg-background px-3"
            placeholder="Model (optional)"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <select
            className="h-9 w-full rounded-md border bg-background px-3"
            value={trigger}
            onChange={(event) => setTrigger(event.target.value as TriggerRun["trigger"])}
          >
            <option value="manual">manual</option>
            <option value="api">api</option>
            <option value="webhook">webhook</option>
          </select>
          <textarea
            className="min-h-[90px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            placeholder="Payload JSON"
            value={payloadJson}
            onChange={(event) => setPayloadJson(event.target.value)}
          />
          <Button onClick={() => void createJob()} disabled={submitting || !message.trim()}>
            {submitting ? "Creating..." : "Create Job"}
          </Button>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Job Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Jobs are triggered only via API (`POST /api/jobs`). This tab shows run logs and links to the created job conversations.
          </p>
          {runs.length === 0 ? <p className="text-muted-foreground">No runs yet.</p> : null}

          {runs.map((run) => (
            <div key={run.id} className="rounded-md border p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{run.id}</span>
                <Badge
                  className={
                    run.status === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : run.status === "error"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                  }
                >
                  {run.status}
                </Badge>
              </div>

              <p>
                <strong>Trigger:</strong> {run.trigger}
              </p>
              <p>
                <strong>Created:</strong> {formatDate(run.createdAt)}
              </p>
              <p>
                <strong>Finished:</strong> {formatDate(run.finishedAt)}
              </p>
              <p>
                <strong>Instruction:</strong> {run.instruction}
              </p>
              <p>
                <strong>Result preview:</strong> {previewResult(run)}
              </p>
              {run.finalResult ? (
                <p>
                  <strong>Final result:</strong> {run.finalResult}
                </p>
              ) : null}
              {run.conversationId ? (
                <p>
                  <strong>Conversation:</strong>{" "}
                  <Link className="text-blue-600 underline" href={`/chat?conversationId=${run.conversationId}`}>
                    Open chat
                  </Link>
                </p>
              ) : null}
              {run.error ? <p className="text-red-700">{run.error}</p> : null}
            </div>
          ))}

          {latest?.conversationId ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
              Latest run conversation:{" "}
              <Link className="underline" href={`/chat?conversationId=${latest.conversationId}`}>
                open chat
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
