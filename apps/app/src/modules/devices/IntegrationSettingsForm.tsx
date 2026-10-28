"use client";
import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@corely/ui";
import type { IntegrationSettings } from "@corely/contracts";
const field =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export function IntegrationSettingsForm({
  settings,
  notesConfigured,
  busy,
  onSave,
  onTest,
}: {
  settings: IntegrationSettings;
  notesConfigured: boolean;
  busy: boolean;
  onSave: (settings: IntegrationSettings) => Promise<void>;
  onTest: (toolId: "weather.forecast" | "notes.create") => Promise<void>;
}) {
  const [weather, setWeather] = useState(settings.weatherEnabled),
    [notes, setNotes] = useState(settings.notesEnabled);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Forecasts use Open-Meteo. Notes destination and credentials are
          configured privately on the runtime server; credentials cannot be read
          back here.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSave({
              weatherEnabled: weather,
              notesEnabled: notes,
              weather: weather
                ? {
                    latitude: Number(f.get("latitude")),
                    longitude: Number(f.get("longitude")),
                    timezone: String(f.get("timezone")),
                    temperatureUnit:
                      f.get("unit") === "fahrenheit" ? "fahrenheit" : "celsius",
                  }
                : settings.weather,
            });
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={weather}
              onChange={(e) => setWeather(e.target.checked)}
            />
            Enable forecast
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Forecast latitude
              <input
                className={field}
                name="latitude"
                type="number"
                min={-90}
                max={90}
                step="any"
                defaultValue={settings.weather?.latitude ?? ""}
                required={weather}
              />
            </label>
            <label className="block text-sm">
              Forecast longitude
              <input
                className={field}
                name="longitude"
                type="number"
                min={-180}
                max={180}
                step="any"
                defaultValue={settings.weather?.longitude ?? ""}
                required={weather}
              />
            </label>
            <label className="block text-sm">
              Forecast timezone
              <input
                className={field}
                name="timezone"
                maxLength={64}
                defaultValue={settings.weather?.timezone ?? "Europe/Berlin"}
                required={weather}
              />
            </label>
            <label className="block text-sm">
              Temperature unit
              <select
                className={field}
                name="unit"
                defaultValue={settings.weather?.temperatureUnit ?? "celsius"}
              >
                <option value="celsius">Celsius</option>
                <option value="fahrenheit">Fahrenheit</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notes}
              disabled={!notesConfigured}
              onChange={(e) => setNotes(e.target.checked)}
            />
            Enable notes
          </label>
          <p className="text-sm">
            Notes server:{" "}
            {notesConfigured
              ? "Configured"
              : "Not configured — set HTTP_NOTES_URL and NOTES_API_TOKEN on the runtime"}
          </p>
          <Button disabled={busy} type="submit">
            Save integration settings
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy || !settings.weatherEnabled}
            onClick={() => void onTest("weather.forecast")}
          >
            Test forecast connection
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !notesConfigured || !settings.notesEnabled}
            onClick={() => void onTest("notes.create")}
          >
            Test notes connection
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Save settings before testing. Connection tests only read; they never
          create notes or call the AI provider. Disabling a tool stops future
          dispatches; an action already sent may still complete.
        </p>
      </CardContent>
    </Card>
  );
}
