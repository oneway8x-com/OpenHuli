"use client";
import { useState } from "react";
import { OPENHULI_PCM_FORMAT } from "@corely/contracts";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@corely/ui";
const field =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export function PairForm({
  busy,
  onPair,
}: {
  busy: boolean;
  onPair: (input: unknown) => Promise<void>;
}) {
  const [profile, setProfile] = useState("weather-station"),
    [display, setDisplay] = useState(false),
    [speaker, setSpeaker] = useState(false);
  const [temperature, setTemperature] = useState(false),
    [humidity, setHumidity] = useState(false);
  const [locationLabel, setLocationLabel] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pair a device</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onPair({
              name: f.get("name"),
              room: f.get("room") || null,
              location: f.get("location")
                ? {
                    label: f.get("location"),
                    latitude: Number(f.get("latitude")),
                    longitude: Number(f.get("longitude")),
                  }
                : null,
              profileId: profile,
              profileVersion: 1,
              capabilities: [
                ...(profile === "sensor-node"
                  ? [
                      ...(temperature ? [{ kind: "temperature" }] : []),
                      ...(humidity ? [{ kind: "humidity" }] : []),
                    ]
                  : profile !== "weather-station"
                    ? [
                        { kind: "microphone", format: OPENHULI_PCM_FORMAT },
                        ...(profile === "esp32-voice" && speaker
                          ? [{ kind: "speaker", format: OPENHULI_PCM_FORMAT }]
                          : []),
                      ]
                    : [{ kind: "temperature" }, { kind: "humidity" }]),
                ...(profile === "esp32-microphone" ? [] : [{ kind: "ping" }]),
                ...(profile !== "esp32-microphone" && display
                  ? [
                      {
                        kind: "display",
                        maxTextLength: Number(f.get("maxTextLength")),
                      },
                    ]
                  : []),
              ],
            });
          }}
        >
          <label className="block text-sm">
            Device name
            <input className={field} name="name" required maxLength={120} />
          </label>
          <label className="block text-sm">
            Room
            <input className={field} name="room" maxLength={120} />
          </label>
          <label className="block text-sm">
            Profile
            <select
              className={field}
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              <option value="sensor-node">Sensor node (Uno / Nano)</option>
              <option value="weather-station">Weather station</option>
              <option value="esp32-voice">ESP32 voice</option>
              <option value="esp32-microphone">ESP32 microphone only</option>
            </select>
          </label>
          {profile === "sensor-node" && (
            <fieldset className="space-y-2">
              <legend className="text-sm">Optional sensors</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={temperature}
                  onChange={(e) => setTemperature(e.target.checked)}
                />
                Temperature sensor
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={humidity}
                  onChange={(e) => setHumidity(e.target.checked)}
                />
                Humidity sensor
              </label>
            </fieldset>
          )}
          {profile !== "esp32-microphone" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={display}
                onChange={(e) => setDisplay(e.target.checked)}
              />
              Has a display
            </label>
          )}
          {profile !== "esp32-microphone" && display && (
            <label className="block text-sm">
              Display character limit
              <input
                className={field}
                key={profile}
                name="maxTextLength"
                type="number"
                min={1}
                max={profile === "sensor-node" ? 32 : 512}
                defaultValue={profile === "sensor-node" ? 32 : 128}
                required
              />
            </label>
          )}
          {profile === "esp32-voice" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={speaker}
                onChange={(e) => setSpeaker(e.target.checked)}
              />
              Has a speaker
            </label>
          )}
          <details>
            <summary className="cursor-pointer text-sm">
              Optional location
            </summary>
            <div className="mt-2 space-y-2">
              <label className="block text-sm">
                Location label
                <input
                  className={field}
                  name="location"
                  maxLength={120}
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Latitude
                <input
                  className={field}
                  name="latitude"
                  required={Boolean(locationLabel)}
                  type="number"
                  min={-90}
                  max={90}
                  step="any"
                />
              </label>
              <label className="block text-sm">
                Longitude
                <input
                  className={field}
                  name="longitude"
                  required={Boolean(locationLabel)}
                  type="number"
                  min={-180}
                  max={180}
                  step="any"
                />
              </label>
            </div>
          </details>
          <Button disabled={busy} type="submit">
            Pair device
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
