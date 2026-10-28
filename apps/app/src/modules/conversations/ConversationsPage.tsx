"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { subscribeSse } from "@corely/api-client";
import {
  OpenHuliVoiceServerMessageSchema,
  type ConsoleSnapshot,
} from "@corely/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@corely/ui";
import {
  consoleFetch,
  closeConversation,
  fetchConversation,
  ConversationListSchema,
  DeviceListSchema,
} from "./conversations-api";

const toolNames: Record<string, string> = {
  device_context: "Read device context",
  "device.ping": "Ping device",
  "display.message": "Display message",
  "weather.forecast": "Get forecast",
  "notes.create": "Create note",
};
type Entry = { id: string; user?: string; answer?: string; final?: boolean };
const label = (status: string, outcome: string | null) =>
  outcome === "partial"
    ? "Partial result"
    : ({
        succeeded: "Confirmed",
        awaiting_approval: "Needs approval",
        unknown: "Outcome unknown",
        denied: "Denied",
        failed: "Failed",
        expired: "Expired",
        cancelled: "Cancelled",
        queued: "Queued",
        running: "Running",
      }[status] ?? status);
const timestamp = (value: string) => new Date(value).toLocaleString();
export function ConversationsPage() {
  const [streamRevision, setStreamRevision] = useState(0);
  const params = useSearchParams(),
    client = useQueryClient();
  const [selected, setSelected] = useState(params.get("id") ?? ""),
    [device, setDevice] = useState("");
  const [draft, setDraft] = useState(""),
    [entries, setEntries] = useState<Entry[]>([]),
    [streamError, setStreamError] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false);
  const retryTurn = useRef<{ id: string; text: string } | null>(null);
  const devices = useQuery({
    queryKey: ["conversation-devices"],
    queryFn: async () => {
      const response = await fetch("/api/devices", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load devices");
      return DeviceListSchema.parse(await response.json());
    },
  });
  const history = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => ConversationListSchema.parse(await consoleFetch()),
  });
  const activity = useQuery({
    queryKey: ["conversation", selected],
    queryFn: () => fetchConversation(selected),
    enabled: Boolean(selected),
    refetchInterval: selected ? 2000 : false,
  });
  const snapshot = activity.data;
  const invalidate = () =>
    client.invalidateQueries({ queryKey: ["conversation", selected] });
  function select(id: string) {
    setConnected(false);
    setSelected(id);
    setEntries([]);
    setDraft("");
    setBusy(false);
    setStreamError("");
    retryTurn.current = null;
    window.history.replaceState(
      null,
      "",
      id ? `/conversations?id=${encodeURIComponent(id)}` : "/conversations",
    );
  }
  const create = useMutation({
    mutationFn: async () => {
      if (selected && snapshot?.live) {
        await closeConversation(selected);
        await client.invalidateQueries({
          queryKey: ["conversation", selected],
        });
      }
      return z
        .object({ id: z.string() })
        .parse(await consoleFetch("", { action: "create", deviceId: device }));
    },
    onSuccess: (result) => {
      select(result.id);
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const pending = retryTurn.current ?? {
        id: crypto.randomUUID(),
        text: draft.trim(),
      };
      retryTurn.current = pending;
      setBusy(true);
      setEntries((previous) =>
        previous.some((e) => e.id === pending.id)
          ? previous
          : [...previous.slice(-29), { id: pending.id, user: pending.text }],
      );
      await consoleFetch("", {
        action: "text",
        conversationId: selected,
        turnId: pending.id,
        text: pending.text,
      });
      retryTurn.current = null;
      setDraft("");
      await invalidate();
    },
  });
  const action = useMutation({
    mutationFn: async (input: Parameters<typeof consoleFetch>[1]) =>
      consoleFetch("", input),
    onSuccess: () => invalidate(),
  });
  useEffect(() => {
    if (!selected || !snapshot?.live) return;
    setConnected(false);
    const controller = new AbortController();
    const connection = subscribeSse(
      `/api/conversations/events?id=${encodeURIComponent(selected)}`,
      {
        signal: controller.signal,
        reconnect: {
          maxAttempts: 3,
          shouldReconnect: (error) =>
            !(
              error instanceof Error &&
              "status" in error &&
              [401, 403, 409].includes(Number(error.status))
            ),
        },
        parseData: (raw) =>
          OpenHuliVoiceServerMessageSchema.parse(JSON.parse(raw)),
        onOpen: () => {
          setConnected(true);
          setStreamError("");
          void client.invalidateQueries({
            queryKey: ["conversation", selected],
          });
        },
        onError: () => {
          setConnected(false);
          setStreamError(
            "Live updates disconnected. Activity refreshes automatically; no turn is resent.",
          );
        },
        onClose: () => {
          setConnected(false);
          setStreamError(
            "Live updates ended. Refresh activity; no turn is resent.",
          );
        },
        onEvent: (event) => {
          const message = event.data;
          if (!message || !("turnId" in message)) return;
          if (
            message.type === "response.delta" ||
            message.type === "response.text"
          ) {
            setEntries((previous) => {
              const existing = previous.find(
                (e) => e.id === message.turnId,
              ) ?? { id: message.turnId };
              const next = {
                ...existing,
                answer:
                  message.type === "response.text"
                    ? message.text
                    : ((existing.answer ?? "") + message.text).slice(0, 4096),
                final: message.type === "response.text",
              };
              return [
                ...previous.filter((e) => e.id !== message.turnId).slice(-29),
                next,
              ];
            });
          }
          if (
            message.type === "turn.completed" ||
            message.type === "turn.failed"
          ) {
            setBusy(false);
            void client.invalidateQueries({
              queryKey: ["conversation", selected],
            });
          }
          if (message.type === "tool.result")
            void client.invalidateQueries({
              queryKey: ["conversation", selected],
            });
        },
      },
    );
    return () => {
      controller.abort();
      connection();
    };
  }, [selected, snapshot?.live, client, streamRevision]);
  const lastLocalTurn = [...entries].reverse().find((entry) => entry.user)?.id;
  const localCompleted = snapshot?.turns.some(
    (turn) =>
      turn.id === lastLocalTurn &&
      ["completed", "failed", "cancelled"].includes(turn.status),
  );
  const active =
    (busy && !localCompleted) ||
    Boolean(
      snapshot?.turns.some((t) =>
        ["collecting", "committed", "responding"].includes(t.status),
      ),
    );
  const error =
    create.error ??
    send.error ??
    action.error ??
    activity.error ??
    history.error ??
    devices.error;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Talk to your devices
        </h1>
        <p className="mt-2 text-muted-foreground">
          Ask a question, review an action, and see what was actually confirmed.
        </p>
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive p-4">
          <p>
            {error instanceof Error ? error.message : "Something went wrong."}
          </p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => {
              void devices.refetch();
              void history.refetch();
              if (selected) void activity.refetch();
            }}
          >
            Refresh activity
          </Button>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Start a conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label
                htmlFor="conversation-device"
                className="text-sm font-medium"
              >
                Active device
              </label>
              <select
                id="conversation-device"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                className="w-full rounded-md border bg-background p-2"
              >
                <option value="">Choose a device</option>
                {devices.data
                  ?.filter((d) => d.status === "active")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.room ? ` · ${d.room}` : ""}
                    </option>
                  ))}
              </select>
              {devices.isLoading ? (
                <p role="status">Loading devices…</p>
              ) : !devices.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  Pair a device to begin. Device onboarding is available through
                  the provisioning API.
                </p>
              ) : null}
              <Button
                className="w-full"
                disabled={!device || create.isPending || active}
                title="Ends the selected live session before starting another"
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Connecting…" : "New conversation"}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {history.data?.map((item) => (
                  <li key={item.id}>
                    <button
                      className={`w-full rounded-md border p-3 text-left text-sm ${selected === item.id ? "border-primary bg-muted" : "hover:bg-muted"}`}
                      aria-current={selected === item.id ? "page" : undefined}
                      onClick={() => select(item.id)}
                    >
                      {devices.data?.find((d) => d.id === item.deviceId)
                        ?.name ?? "Device conversation"}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {timestamp(item.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {history.isLoading ? (
                <p>Loading activity…</p>
              ) : !history.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No conversations yet.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
        <div className="min-w-0 space-y-4">
          {!selected ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Choose a device and start a conversation.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>
                      {devices.data?.find((d) => d.id === snapshot?.deviceId)
                        ?.name ?? "Conversation"}
                    </CardTitle>
                    <Badge variant="secondary">
                      {snapshot?.live
                        ? active
                          ? "Working"
                          : "Ready"
                        : "Read only"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {activity.isLoading ? (
                    <p role="status">Loading conversation…</p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {snapshot?.retainTranscripts
                      ? "Saved transcript available below."
                      : "Transcript retention is off. Refresh restores activity, but previous conversation text is not stored."}
                  </p>
                  {streamError ? (
                    <div>
                      <Button
                        variant="outline"
                        onClick={() => setStreamRevision((value) => value + 1)}
                      >
                        Reconnect live updates
                      </Button>
                      <p role="status" className="text-sm text-amber-700">
                        {streamError}
                      </p>
                    </div>
                  ) : null}
                  {snapshot?.retainTranscripts
                    ? snapshot.messages
                        .filter((m) => m.text)
                        .reverse()
                        .map((m) => (
                          <div key={m.id}>
                            <p className="text-xs font-medium text-muted-foreground">
                              {m.role} · {timestamp(m.createdAt)}
                            </p>
                            <p className="whitespace-pre-wrap break-words">
                              {m.text}
                            </p>
                          </div>
                        ))
                    : null}
                  <div aria-live="polite" className="space-y-4">
                    {entries.map((entry) => (
                      <div key={entry.id} className="space-y-2">
                        {entry.user ? (
                          <p className="rounded-lg bg-muted p-3 whitespace-pre-wrap break-words">
                            <strong>You:</strong> {entry.user}
                          </p>
                        ) : null}
                        {entry.answer ? (
                          <div className="rounded-lg border p-3">
                            <p className="text-xs text-muted-foreground">
                              {entry.final
                                ? "Assistant answer"
                                : "Assistant preview"}{" "}
                              · action status appears in the tool cards
                            </p>
                            <p className="mt-1 whitespace-pre-wrap break-words">
                              {entry.answer}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {snapshot?.turns.length ? (
                    <p className="text-sm text-muted-foreground">
                      Latest turn: {snapshot.turns[0]?.status}
                    </p>
                  ) : null}
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send.mutate();
                    }}
                  >
                    <label
                      htmlFor="conversation-message"
                      className="text-sm font-medium"
                    >
                      Message
                    </label>
                    <textarea
                      id="conversation-message"
                      className="min-h-24 w-full rounded-md border bg-background p-3"
                      maxLength={4096}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      disabled={
                        !snapshot?.live ||
                        !connected ||
                        active ||
                        create.isPending
                      }
                      placeholder="Ask about this device…"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        disabled={
                          !snapshot?.live ||
                          !connected ||
                          active ||
                          create.isPending ||
                          !draft.trim() ||
                          send.isPending
                        }
                      >
                        Send message
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          !snapshot?.live || !active || action.isPending
                        }
                        onClick={() =>
                          action.mutate({
                            action: "cancel",
                            conversationId: selected,
                          })
                        }
                      >
                        Stop
                      </Button>
                    </div>
                  </form>
                  {!snapshot?.live ? (
                    <p className="text-sm text-muted-foreground">
                      This session cannot accept new turns. Start a new
                      conversation; previous actions will not be replayed.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
              <ToolCards
                snapshot={snapshot}
                pending={action.isPending}
                devices={devices.data ?? []}
                decide={(input) => action.mutate(input)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function ToolCards({
  snapshot,
  pending,
  decide,
  devices,
}: {
  snapshot: ConsoleSnapshot | undefined;
  devices: z.infer<typeof DeviceListSchema>;
  pending: boolean;
  decide: (input: Parameters<typeof consoleFetch>[1]) => void;
}) {
  return (
    <section aria-label="Tool activity" className="space-y-3">
      <h2 className="text-xl font-semibold">Tool activity</h2>
      {!snapshot?.executions.length ? (
        <p className="text-sm text-muted-foreground">
          No tool actions recorded.
        </p>
      ) : (
        snapshot.executions.map((execution) => {
          const expired =
            !execution.expiresAt ||
            new Date(execution.expiresAt).getTime() <= Date.now();
          const reviewable =
            !JSON.stringify(execution.arguments).includes("[redacted]") &&
            execution.arguments.unavailable !== true;
          const approval =
            reviewable &&
            execution.status === "awaiting_approval" &&
            execution.approvalId &&
            execution.requestHash &&
            !expired;
          const decideApproval = (decision: "approve" | "reject") =>
            decide({
              action: "approval",
              conversationId: snapshot.id,
              executionId: execution.executionId,
              approvalId: execution.approvalId!,
              requestHash: execution.requestHash!,
              targetDeviceId: execution.targetDeviceId,
              decision,
            });
          return (
            <Card key={execution.executionId}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="break-all text-base">
                    {toolNames[execution.toolId] ?? execution.toolId}
                  </CardTitle>
                  <Badge
                    variant={
                      execution.status === "succeeded" &&
                      execution.outcome !== "partial"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {expired && execution.status === "awaiting_approval"
                      ? "Expired"
                      : label(execution.status, execution.outcome)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {timestamp(execution.createdAt)} · {execution.executionId}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="break-all text-sm">
                  Target:{" "}
                  {devices.find(
                    (device) => device.id === execution.targetDeviceId,
                  )?.name ??
                    execution.targetDeviceId ??
                    "Tenant"}
                </p>
                <details open={Boolean(approval)}>
                  <summary className="cursor-pointer text-sm font-medium">
                    Exact arguments
                  </summary>
                  <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(execution.arguments, null, 2)}
                  </pre>
                </details>
                {execution.output?.kind === "forecast" &&
                execution.output.source === "Open-Meteo" ? (
                  <p className="text-sm text-muted-foreground">
                    Forecast data by{" "}
                    <a
                      className="underline"
                      href="https://open-meteo.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open-Meteo.com
                    </a>{" "}
                    ·{" "}
                    <a
                      className="underline"
                      href="https://creativecommons.org/licenses/by/4.0/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      CC BY 4.0
                    </a>{" "}
                    · Fetched{" "}
                    {typeof execution.output.fetchedAt === "string"
                      ? timestamp(execution.output.fetchedAt)
                      : "time unavailable"}
                  </p>
                ) : null}
                {execution.output ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Result, sources and timestamps
                    </summary>
                    <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                      {JSON.stringify(execution.output, null, 2)}
                    </pre>
                  </details>
                ) : null}
                {execution.status === "awaiting_approval" && !reviewable ? (
                  <p className="text-sm">
                    Some arguments are hidden. Cancel this action and make a
                    request you can fully review.
                  </p>
                ) : null}
                {approval ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      Review the target and exact arguments before approving.
                      Approval expires at {timestamp(execution.expiresAt!)}. An
                      approval may time out sooner if its turn stops.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={pending}
                        onClick={() => decideApproval("approve")}
                      >
                        Approve action
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => decideApproval("reject")}
                      >
                        Deny action
                      </Button>
                    </div>
                  </div>
                ) : null}
                {["queued", "running", "awaiting_approval"].includes(
                  execution.status,
                ) ? (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      decide({
                        action: "cancel-execution",
                        conversationId: snapshot.id,
                        executionId: execution.executionId,
                      })
                    }
                  >
                    Cancel action
                  </Button>
                ) : null}
                {execution.status === "unknown" ? (
                  <p className="text-sm text-amber-700">
                    The action may have happened. Check the target before trying
                    again.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </section>
  );
}
