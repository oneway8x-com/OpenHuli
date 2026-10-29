# Weather station firmware

The imported Weather Station V1 runs on a LOLIN ESP32-S2 Mini with a DHT11 and a bare parallel
LCD1602A. It keeps its room readings, Berlin clock and Open-Meteo weather pages, and optionally
connects to OpenHuli using the shared [C++ client](../../libraries/OpenHuli/README.md).

| Folder                                                                | Purpose                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [weather_station_online](weather_station_online/README.md)            | Main station: local pages, HTTPS forecast, optional OpenHuli MQTT |
| [weather_station_test](weather_station_test/weather_station_test.ino) | Offline sensor/LCD diagnostic using the current outer-row pins    |
| [weather_station_lcd_test](weather_station_lcd_test/README.md)        | Fixed LCD-only diagnostic using the same pins                     |
| [clock](clock/README.md)                                              | Preserved earlier clock variant with a different pin map          |
| tests                                                                 | Synthetic parser, display, timing and OpenHuli adapter checks     |

The current wiring is RS=3, E=5, D4=7, D5=12, D6=33, D7=35, DHT11 DATA=37. Follow the
[hardware guide](../../hardware/weather-station/README.md) before uploading. Each variant is a
separate PlatformIO project; uploading a diagnostic replaces the main firmware.

From the repository root:

```sh
pio run --project-dir firmware/weather-station/weather_station_online
pio run --project-dir firmware/weather-station/weather_station_online --environment lolin_s2_mini_check
pnpm exec tsx --test scripts/weather-station.test.ts
```

The check environment always ignores private configuration and compiles the cloud adapter.
Never upload its image. The normal environment starts locally with empty example credentials.
Cloud support requires explicit pairing and private configuration; see the main station guide.

Code originated in the Ha-DIYs `Weather_Station_V1` project. Runtime logs, private configuration
and old machine-specific verification records were not imported. Earlier hardware reports do not
qualify the new combined firmware. Physical MQTT/TLS, display effects, sensor voltage compatibility,
network recovery, power cuts and endurance still need testing on the actual station.
