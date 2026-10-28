"use client";
import { useState } from "react";
import { z } from "zod";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@corely/ui";
import { DetailSchema, type Device } from "./devices-api";
const field =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const time = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "No observation yet";
export function GrantForm({
  device,
  devices,
  grants,
  busy,
  onSave,
  onRevoke,
}: {
  device: Device;
  devices: Device[];
  grants: z.infer<typeof DetailSchema>["grants"];
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
  onRevoke: (toolId: string) => Promise<void>;
}) {
  const [tool, setTool] = useState("device_context"),
    [target, setTarget] = useState(device.id);
  const deviceTool = [
    "device_context",
    "device.ping",
    "display.message",
    "telemetry.latest",
    "telemetry.history",
  ].includes(tool);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Device tool grants</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Grants permit device-originated requests. They do not approve a write
          or bypass capability checks.
        </p>
        {grants.length === 0 && <p>No grants assigned.</p>}
        {grants.map((g) => (
          <div className="rounded-md border p-3 text-sm" key={g.toolId}>
            <p>
              {g.toolId} ·{" "}
              {g.revokedAt
                ? "Revoked"
                : new Date(g.expiresAt) <= new Date()
                  ? "Expired"
                  : "Active"}
            </p>
            <p className="text-muted-foreground">
              {g.targetDeviceIds
                .map((id) => devices.find((d) => d.id === id)?.name ?? id)
                .join(", ") || "Tenant tool"}{" "}
              · expires {time(g.expiresAt)}
            </p>
            {!g.revokedAt && (
              <Button
                variant="secondary"
                disabled={busy || device.status !== "active"}
                onClick={() => void onRevoke(g.toolId)}
              >
                Revoke grant {g.toolId}
              </Button>
            )}
          </div>
        ))}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSave({
              toolId: tool,
              targetDeviceIds: deviceTool ? [target] : [],
              expiresAt: new Date(String(f.get("expiresAt"))).toISOString(),
            });
          }}
        >
          <label className="block text-sm">
            Tool
            <select
              className={field}
              value={tool}
              onChange={(e) => setTool(e.target.value)}
            >
              {[
                "device_context",
                "device.ping",
                "display.message",
                "weather.forecast",
                "notes.create",
                "telemetry.latest",
                "telemetry.history",
                "device.list",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {deviceTool && (
            <label className="block text-sm">
              Target device
              <select
                className={field}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {devices
                  .filter((d) => d.status === "active")
                  .map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="block text-sm">
            Grant expiry
            <input
              className={field}
              name="expiresAt"
              type="datetime-local"
              required
            />
          </label>
          <Button disabled={busy || device.status !== "active"} type="submit">
            Save grant
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
