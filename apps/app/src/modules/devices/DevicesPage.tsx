"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { type IntegrationSettings } from "@corely/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@corely/ui";
import {
  deviceFetch,
  DeviceSchema,
  DetailSchema,
  PairResultSchema,
  IssuedSchema,
  IntegrationViewSchema,
  TelemetryViewSchema,
  ExecutionSchema,
} from "./devices-api";
import { PairForm } from "./PairDeviceForm";
import { GrantForm } from "./DeviceGrants";
import { HistoryChart } from "./TelemetryHistory";
import { IntegrationSettingsForm } from "./IntegrationSettingsForm";

const field =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const time = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "No observation yet";
const states: Record<string, string> = {
  awaiting_approval: "Needs approval",
  queued: "Queued",
  running: "Waiting for device receipt",
  succeeded: "Confirmed",
  unknown: "Outcome unknown — check the device before retrying",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  denied: "Denied",
};
export function DevicesPage() {
  const params = useSearchParams(),
    client = useQueryClient();
  const [selected, setSelected] = useState(params.get("id") ?? "");
  const [execution, setExecution] = useState(params.get("execution") ?? "");
  const [pendingRequest, setPendingRequest] = useState(
    params.get("request") ?? "",
  );
  const [oneTime, setOneTime] = useState<unknown>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [revoke, setRevoke] = useState<string | null>(null),
    [displayText, setDisplayText] = useState("");
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: async () =>
      z.array(DeviceSchema).parse(await deviceFetch("/api/devices")),
  });
  const detail = useQuery({
    queryKey: ["device", selected],
    enabled: Boolean(selected),
    queryFn: async () =>
      DetailSchema.parse(
        await deviceFetch(`/api/devices/${encodeURIComponent(selected)}`),
      ),
  });
  const integrations = useQuery({
    queryKey: ["device-integrations"],
    queryFn: async () =>
      IntegrationViewSchema.parse(await deviceFetch("/api/device-management")),
  });
  const telemetry = useQuery({
    queryKey: ["device-telemetry", selected],
    enabled: Boolean(selected && detail.data?.device.status === "active"),
    refetchInterval: 5000,
    queryFn: async () =>
      TelemetryViewSchema.parse(
        await deviceFetch(
          `/api/device-management?device=${encodeURIComponent(selected)}`,
        ),
      ),
  });
  const command = useQuery({
    queryKey: ["manual-command", selected, execution, pendingRequest],
    enabled: Boolean(execution || pendingRequest),
    refetchInterval: (query) =>
      ["queued", "running", "awaiting_approval"].includes(
        query.state.data?.status ?? "queued",
      )
        ? 1000
        : false,
    queryFn: async () =>
      ExecutionSchema.parse(
        await deviceFetch(
          `/api/device-management?${execution ? "execution=" + encodeURIComponent(execution) : "request=" + encodeURIComponent(pendingRequest)}&device=${encodeURIComponent(selected)}`,
        ),
      ),
  });
  function select(id: string, executionId = "") {
    setPendingRequest("");
    setSelected(id);
    setExecution(executionId);
    setOneTime(null);
    setRevoke(null);
    setDisplayText("");
    setError("");
    setNotice("");
    window.history.replaceState(
      null,
      "",
      `/devices${id ? `?id=${encodeURIComponent(id)}` : ""}${executionId ? `&execution=${encodeURIComponent(executionId)}` : ""}`,
    );
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["devices"] }),
        client.invalidateQueries({ queryKey: ["device", selected] }),
        client.invalidateQueries({ queryKey: ["device-integrations"] }),
        client.invalidateQueries({ queryKey: ["manual-command"] }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function send(toolId: "device.ping" | "display.message") {
    await act(async () => {
      const requestId = crypto.randomUUID();
      setPendingRequest(requestId);
      window.history.replaceState(
        null,
        "",
        `/devices?id=${encodeURIComponent(selected)}&request=${requestId}`,
      );
      const result = z.object({ executionId: z.string() }).parse(
        await deviceFetch("/api/device-management", "POST", {
          action: "command",
          deviceId: selected,
          requestId,
          toolId,
          ...(toolId === "display.message" ? { text: displayText } : {}),
        }),
      );
      select(selected, result.executionId);
    });
  }
  const active = detail.data?.device.status === "active";
  const display = detail.data?.device.capabilities.find(
    (c) => c.kind === "display",
  );
  const ping = detail.data?.device.capabilities.some(
    (capability) => capability.kind === "ping",
  );
  const pending = command.data?.status === "awaiting_approval";
  const commandBusy = Boolean(
    command.isError ||
    ((pendingRequest || execution) && !command.data) ||
    (command.data &&
      ["queued", "running", "awaiting_approval"].includes(command.data.status)),
  );
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Your home · Devices and integrations
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Connect your devices
        </h1>
        <p className="mt-2 text-muted-foreground">
          Pair hardware, check measured readings, and control the tools it can
          use.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border p-3">
          {notice}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Your devices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {devices.isPending && <p>Loading devices…</p>}
              {devices.isError && <p role="alert">Could not load devices.</p>}
              {devices.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No devices yet. Pair your first device below.
                </p>
              )}
              {devices.data?.map((d) => (
                <button
                  key={d.id}
                  onClick={() => select(d.id)}
                  aria-pressed={d.id === selected}
                  className={`w-full rounded-md border p-3 text-left ${d.id === selected ? "border-primary bg-muted" : "border-border"}`}
                >
                  <span className="block font-medium">{d.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {d.room ?? "No room"} · {d.status}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
          <PairForm
            busy={busy}
            onPair={(input) =>
              act(async () => {
                const result = PairResultSchema.parse(
                  await deviceFetch("/api/devices", "POST", input),
                );
                select(result.device.id);
                setOneTime(result);
                setNotice(
                  "Device paired. Save the configuration below before leaving this page.",
                );
              })
            }
          />
        </div>
        <div className="min-w-0 space-y-5">
          {oneTime !== null && (
            <Card>
              <CardHeader>
                <CardTitle>Save your device configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  Device credentials are shown once. Keep this configuration
                  private. The server does not return these tokens again.
                </p>
                <pre
                  aria-label="One-time device configuration"
                  className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs"
                >
                  {JSON.stringify(oneTime, null, 2)}
                </pre>
                <Button variant="secondary" onClick={() => setOneTime(null)}>
                  Hide credentials
                </Button>
              </CardContent>
            </Card>
          )}
          {!selected && (
            <Card>
              <CardContent className="pt-6 text-muted-foreground">
                Choose a device to see its readings, credentials and
                permissions.
              </CardContent>
            </Card>
          )}
          {selected && detail.isPending && <p>Loading device…</p>}
          {detail.isError && (
            <p role="alert">Device unavailable or outside your home.</p>
          )}
          {detail.data && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{detail.data.device.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge>{detail.data.device.status}</Badge>
                    {detail.data.device.capabilities.map((c) => (
                      <Badge variant="secondary" key={c.kind}>
                        {c.kind}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {detail.data.device.room ?? "No room"} ·{" "}
                    {detail.data.device.location?.label ?? "No location"} ·{" "}
                    {detail.data.device.profileId} v
                    {detail.data.device.profileVersion}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    Device ID: {selected}
                  </p>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      Firmware configuration and MQTT topics
                    </summary>
                    <p className="my-2 text-sm">
                      Use the runtime’s verified WSS URL and the broker’s TLS
                      endpoint from your installation. Credentials below are
                      purpose-specific; provider keys never belong on the
                      device.
                    </p>
                    <pre className="overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(
                        { device: detail.data.device, mqtt: detail.data.mqtt },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Measured readings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!active ? (
                    <p>Device deactivated.</p>
                  ) : telemetry.isError ? (
                    <p role="alert">
                      Readings unavailable. Check the runtime connection.
                    </p>
                  ) : telemetry.isPending ? (
                    <p>Loading readings…</p>
                  ) : telemetry.data?.available === false ? (
                    <p>Telemetry is not enabled on this runtime.</p>
                  ) : (
                    telemetry.data?.available && (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            Presence: {telemetry.data.latest.connectivity}
                          </Badge>
                          <Badge variant="secondary">
                            Readings: {telemetry.data.latest.freshness}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Sampled: {time(telemetry.data.latest.sampledAt)} ·
                          Last seen: {time(telemetry.data.latest.lastSeenAt)}
                        </p>
                        {telemetry.data.latest.readings.length === 0 && (
                          <p>
                            No measured readings yet. Forecasts are shown
                            separately.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-5">
                          {telemetry.data.latest.readings.map((r) => (
                            <div key={r.metric}>
                              <p className="text-sm capitalize text-muted-foreground">
                                {r.metric}
                              </p>
                              <p className="text-2xl font-semibold">
                                {r.value} {r.unit === "degC" ? "°C" : "%"}
                              </p>
                            </div>
                          ))}
                        </div>
                        {telemetry.data.latest.sensorErrors.map((e) => (
                          <p role="status" key={e.metric}>
                            {e.metric}: sensor {e.code.replaceAll("_", " ")}
                          </p>
                        ))}
                        <HistoryChart items={telemetry.data.history.items} />
                      </>
                    )
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Manual commands</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Confirmation requires an actual device receipt. Reopening
                    this page only reads status.
                  </p>
                  {ping ? (
                    <Button
                      disabled={busy || !active || commandBusy}
                      onClick={() => void send("device.ping")}
                    >
                      Ping device
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Ping commands are unsupported by this device.
                    </p>
                  )}
                  {display?.kind === "display" ? (
                    <div className="space-y-2">
                      <label className="block text-sm">
                        Display text
                        <input
                          className={field}
                          value={displayText}
                          maxLength={display.maxTextLength}
                          onChange={(e) => setDisplayText(e.target.value)}
                        />
                      </label>
                      <Button
                        disabled={
                          busy || !active || commandBusy || !displayText.trim()
                        }
                        onClick={() => void send("display.message")}
                      >
                        Send to display
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Display commands are unsupported by this device.
                    </p>
                  )}
                  {command.isError && (
                    <p role="alert">
                      Command status unavailable. Check the device before
                      sending another command.
                    </p>
                  )}
                  {command.isError && pendingRequest && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        select(selected);
                      }}
                    >
                      I checked the device; clear pending command
                    </Button>
                  )}
                  {command.data && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p role="status" className="font-medium">
                        {command.data.outcome === "partial"
                          ? "Partial result"
                          : (states[command.data.status] ??
                            command.data.status)}
                      </p>
                      <p className="break-all text-xs">
                        Execution: {command.data.executionId}
                      </p>
                      <pre className="whitespace-pre-wrap break-all text-xs">
                        {JSON.stringify(command.data.arguments, null, 2)}
                      </pre>
                      {pending && (
                        <>
                          <p className="text-sm">
                            Confirm {command.data.toolId} on{" "}
                            {detail.data.device.name}. Approval expires{" "}
                            {time(command.data.expiresAt)}.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {["approve", "reject"].map((decision) => (
                              <Button
                                key={decision}
                                variant={
                                  decision === "approve"
                                    ? "default"
                                    : "secondary"
                                }
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    const current = command.data;
                                    if (!current?.approvalId) return;
                                    await deviceFetch(
                                      "/api/device-management",
                                      "POST",
                                      {
                                        action: "approval",
                                        decision: {
                                          version: 1,
                                          executionId: current.executionId,
                                          approvalId: current.approvalId,
                                          requestHash: current.requestHash,
                                          targetDeviceId:
                                            current.targetDeviceId,
                                          decision,
                                        },
                                      },
                                    );
                                  })
                                }
                              >
                                {decision === "approve"
                                  ? "Approve command"
                                  : "Deny command"}
                              </Button>
                            ))}
                          </div>
                        </>
                      )}
                      {commandBusy && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await deviceFetch(
                                "/api/device-management",
                                "POST",
                                { action: "cancel", executionId: execution },
                              );
                            })
                          }
                        >
                          Cancel command
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Credentials</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail.data.credentials.map((c) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                      key={c.id}
                    >
                      <div>
                        <p className="font-medium">
                          {c.purpose} ·{" "}
                          {c.revokedAt
                            ? "Revoked"
                            : new Date(c.expiresAt) <= new Date()
                              ? "Expired"
                              : "Active"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Expires {time(c.expiresAt)}
                        </p>
                      </div>
                      {!c.revokedAt && active && (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                const issued = IssuedSchema.parse(
                                  await deviceFetch(
                                    `/api/devices/${selected}/credentials`,
                                    "POST",
                                    { credentialId: c.id, purpose: c.purpose },
                                  ),
                                );
                                setOneTime({
                                  device: detail.data.device,
                                  credentials: [issued],
                                  mqtt: detail.data.mqtt,
                                });
                                setNotice(
                                  "Credential rotated. Update your device with its new token.",
                                );
                              })
                            }
                          >
                            Rotate {c.purpose}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setRevoke(c.id)}
                          >
                            Revoke {c.purpose}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {revoke && (
                    <div className="space-y-2 rounded-md border border-destructive p-3">
                      <p>
                        Revoke this credential? Active connections will lose
                        access.
                      </p>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await deviceFetch(
                              `/api/devices/${selected}/credentials/${revoke}`,
                              "DELETE",
                            );
                            setRevoke(null);
                            setOneTime(null);
                            setNotice("Credential revoked.");
                          })
                        }
                      >
                        Confirm revocation
                      </Button>{" "}
                      <Button
                        variant="secondary"
                        onClick={() => setRevoke(null)}
                      >
                        Keep credential
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              <GrantForm
                device={detail.data.device}
                devices={devices.data ?? []}
                grants={detail.data.grants}
                busy={busy}
                onSave={(body) =>
                  act(async () => {
                    await deviceFetch(
                      `/api/devices/${selected}/grants`,
                      "PUT",
                      body,
                    );
                    setNotice(
                      "Tool grant saved. Write tools still need owner consent.",
                    );
                  })
                }
                onRevoke={(toolId) =>
                  act(async () => {
                    await deviceFetch(
                      `/api/devices/${selected}/grants/${encodeURIComponent(toolId)}`,
                      "DELETE",
                    );
                    setNotice("Tool grant revoked.");
                  })
                }
              />
            </>
          )}
          {integrations.isError && (
            <p role="alert">
              Integration settings unavailable. Check the runtime connection.
            </p>
          )}
          {integrations.data && (
            <IntegrationSettingsForm
              key={JSON.stringify(integrations.data.settings)}
              settings={integrations.data.settings}
              notesConfigured={integrations.data.notesConfigured}
              busy={busy}
              onSave={(settings: IntegrationSettings) =>
                act(async () => {
                  await deviceFetch("/api/device-management", "POST", {
                    action: "settings",
                    settings,
                  });
                  setNotice("Integration settings saved.");
                })
              }
              onTest={(toolId) =>
                act(async () => {
                  const result = z
                    .object({ ok: z.boolean(), message: z.string() })
                    .parse(
                      await deviceFetch("/api/device-management", "POST", {
                        action: "test",
                        toolId,
                      }),
                    );
                  setNotice(result.message);
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
