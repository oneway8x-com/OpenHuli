import type { z } from "zod";
import type { DeviceReadingSchema } from "@corely/contracts";
const time = (value: string) => new Date(value).toLocaleString();
export function HistoryChart({
  items,
}: {
  items: {
    sampledAt?: string;
    readings?: z.infer<typeof DeviceReadingSchema>[];
  }[];
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">
        Last 24 hours · up to 100 latest samples
      </h3>
      {["temperature", "humidity"].map((metric) => {
        const points = items
          .flatMap((i) =>
            i.readings
              .filter((r) => r.metric === metric)
              .map((r) => ({ at: Date.parse(i.sampledAt), value: r.value })),
          )
          .sort((a, b) => a.at - b.at);
        if (!points.length)
          return (
            <p key={metric} className="text-sm text-muted-foreground">
              No {metric} history.
            </p>
          );
        const now = Date.now(),
          from = now - 86400000,
          low = Math.min(...points.map((p) => p.value)),
          high = Math.max(...points.map((p) => p.value));
        const coords = points.map((p) => ({
          x: 10 + Math.max(0, Math.min(1, (p.at - from) / 86400000)) * 580,
          y: 85 - ((p.value - low) / (high - low || 1)) * 65,
        }));
        return (
          <figure key={metric}>
            <figcaption className="text-xs capitalize">
              {metric} ({metric === "temperature" ? "°C" : "%"}) · {low}–{high}
            </figcaption>
            <svg
              viewBox="0 0 600 100"
              role="img"
              aria-label={`${metric} measurements over the last 24 hours`}
              className="w-full rounded-md border bg-muted/30 text-primary"
            >
              <path d="M10 90H590" stroke="currentColor" opacity=".2" />
              <polyline
                points={coords.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              {coords.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3" fill="currentColor">
                  <title>{`${time(new Date(points[i].at).toISOString())}: ${points[i].value}`}</title>
                </circle>
              ))}
            </svg>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>24 hours ago</span>
              <span>Now</span>
            </div>
          </figure>
        );
      })}
    </div>
  );
}
