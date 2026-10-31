# Berlin weather station with OpenHuli

Firmware for the LOLIN ESP32-S2 Mini, bare LCD1602A and DHT11. It shows room
measurements, Berlin date/time and outdoor weather downloaded over Wi-Fi.
Optional OpenHuli integration uses the repository's `OpenHuli` library.
This separate project uses the **same outer-row wiring as the offline test**:
LCD RS=3, E=5, D4=7, D5=12, D6=33, D7=35; DHT11 DATA=37.

Follow the [complete wiring guide](../../../hardware/weather-station/docs/WIRING.md) first. Use
USB-C power only for this assembly; leave the battery and charger disconnected.
Inspect the sensor's actual printed labels, LCD logic compatibility and
backlight current limiting as described there. Building software does not
verify physical wiring.

## Set up Wi-Fi and upload

From the repository root:

```sh
cd firmware/weather-station/weather_station_online
cp wifi_config.example.h wifi_config.h
```

Edit `wifi_config.h`: put your **2.4 GHz** network name in `kSsid` and password
in `kPassword`. This local file is ignored by Git; keep the example empty.
Credentials become part of the compiled binary, so keep configured binaries
private. No weather API account, key or subscription is needed for this
personal home station.

The shared source and example contain no saved Wi-Fi credentials. To clear
your local configuration, copy `wifi_config.example.h` over `wifi_config.h`
and rebuild. Existing configured firmware binaries also contain the password;
discard them when clearing credentials. Clearing local files does not erase
the firmware already running on the board.

```sh
uvx --with intelhex --from platformio pio run
uvx --with intelhex --from platformio pio device list
```

Confirm the ESP32-S2 board and its port, then replace the placeholder:

```sh
uvx --with intelhex --from platformio pio run --target upload --upload-port /dev/cu.YOUR_BOARD_PORT
uvx --with intelhex --from platformio pio device monitor --port /dev/cu.YOUR_BOARD_PORT --baud 115200
```

This is a PlatformIO project with pinned Espressif32 7.1.3, LiquidCrystal
1.0.7, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15 and ArduinoJson
6.21.5. Native USB CDC is enabled by the board configuration and checked in
the source; using UART RX would conflict with the DHT on GPIO37.
The [hardware testing guide](../../../hardware/weather-station/docs/TESTING.md) covers BOOT/RESET
and missing ports. Build/upload **from this folder**; the sibling `clock`
project uses an earlier GPIO map. Keep `libraries/OpenHuli` in the same checkout.

Without `wifi_config.h` the project still builds and shows `Set Wi-Fi config`.
Room sensing works without Wi-Fi. After every power loss, internet access to
NTP (UDP 123) is needed before the clock and certificate-verified weather
download can start. Wi-Fi reconnects about every 30 seconds. A captive portal
or enterprise Wi-Fi login is not supported.

## Connect to OpenHuli

1. Pair a device in the OpenHuli owner console with profile `weather-station` version 1,
   temperature, humidity, ping and display with maximum text length 32.
2. Copy `config.example.h` to ignored `config.local.h`. Set `enabled=true`, then copy the
   issued device ID, `mqttUsername`, `mqttClientId` and the MQTT-purpose token into it.
3. Configure the deployment's broker hostname, TLS port and PEM CA in that private file.
   The weather API roots in `certs/` are separate from the broker's trust configuration.
   For a multiline CA use a C++ raw string such as `R"PEM(...certificate...)PEM"`.
4. Enable the deployment's existing [MQTT telemetry](../../../docs/guides/MQTT_TELEMETRY.md)
   and [device commands](../../../docs/guides/DEVICE_COMMANDS.md), then build the normal
   `lolin_s2_mini` environment. Do not upload the CI `lolin_s2_mini_check` image.

The library owns TLS/hostname verification, the v1 manifest, exact device topics, online/offline
presence, command deadlines/deduplication and receipts. There are no owner, AI-provider or
Tenant-wide credentials on the station. Configuration errors leave local operation running.
No server schema, new endpoint or database migration is required.

The sensor still reads every two seconds; the adapter attempts a cloud report from a new reading
about every 30 seconds. Only indoor DHT11 values are published. Failed or invalid reads send
explicit errors for both metrics, never the previous successful values. A disconnected report is
dropped; reconnect does not replay history or redate old samples. Clock synchronization is required
by the client before publishing. Leave the backend telemetry interval at its default 30 seconds.

Ping and display commands use the existing owner permissions and approval flow. A display message
contains at most 32 printable ASCII characters, wraps at column 16, and pads both rows. It stays
for 15 seconds, then the usual pages resume. The LCD driver is write-only: a success receipt confirms
the GPIO sequence completed, not visible pixels. The application owns all client/display calls in
the main task, while the existing HTTPS worker only fetches weather.

Before a command effect, its expiry is committed to an NVS fence in `openhuli_cmd`. The fence
survives restart; uncertain commands are not replayed. A journal initialization/read/write fault
fails closed. Do not erase NVS to retry an uncertain command. Local sensing/pages continue when
cloud credentials are missing, the broker is offline, or the journal cannot initialize.

## What appears on the LCD

After a two-second startup and a two-second provider credit, three pages
rotate every 15 seconds. These are illustrative values, not measurements:

| Page   | First row         | Second row         |
| ------ | ----------------- | ------------------ |
| Room   | `Room 23.0C  45%` | `25/10/2026 12:00` |
| Berlin | `Berlin 12.3C`    | `Overcast H 76%`   |
| Today  | `Lo  7C Hi 14C`   | `Rain 35% W 15kmh` |

The Berlin page alternates its second row with `open-meteo.com`. Temperatures
are Celsius; humidity is relative humidity; W is current wind speed in km/h.
Rain is today's maximum precipitation probability, rounded to a whole percent.
Lo/Hi are today's forecast minimum/maximum, rounded to whole degrees.
The clock uses DD/MM/YYYY HH:MM with Berlin CET/CEST changes automatically.

The DHT11 is sampled at least two seconds apart. Failed reads show
`DHT11 ERROR` on the room page; the clock and weather pages continue.
LCD rows are padded to 16 characters and updated only when changed.
Decimal display precision does not establish sensor or forecast accuracy.
USB serial reports connection, clock, cache and sensor status every ten
seconds; send `?` to request a status snapshot immediately. `LCD intended`
reports the text sent to the controller, not confirmation of a visible image.

## Weather service and failure behaviour

[Open-Meteo Forecast API](https://open-meteo.com/en/docs) supplies
model-derived outdoor conditions for Berlin city centre (52.52437, 13.41053),
separately from the indoor DHT11 measurements. Requested fields are current
temperature, relative humidity, WMO weather code, wind speed, day/night and
today's temperature minimum/maximum and maximum precipitation probability.
`settings.h` contains the URL, units, pin map, Berlin timezone and timings.
Changing location requires changing both the API location/timezone and the
local POSIX timezone rule and display labels.

A successful download schedules the next request 15 minutes later (about
96/day under normal conditions). Failures back off for 1, 2, 4, 8, then 15
minutes; HTTP 429/503 honors numeric `Retry-After`, defaulting to 15 minutes
when absent or in another format. Failed requests never replace good data.

- Cached weather gets `*` after 30 minutes, measured against both receipt
  uptime and the API's current timestamp. At two hours it is replaced with
  `Data expired`. The cache is held in RAM and clears on restart.
- A previous day's forecast shows `Forecast old` / `Waiting refresh` until
  the next successful download, normally within 15 minutes after midnight.
- Before the first success the display reports configuration, connection,
  time synchronization or download status. Details appear on USB serial.
- Unknown weather codes display `Unknown`. Missing/null values, incorrect
  units, invalid timestamps and implausible ranges are rejected.
- The clock continues after Wi-Fi drops once synchronized, with possible
  software-clock drift until NTP corrects it. There is no battery-backed RTC.

HTTPS runs in a separate FreeRTOS task so slow downloads do not occupy the
LCD/sensor loop. Connection timeout is 5 seconds, TLS handshake timeout 8
seconds, socket timeout 8 seconds and overall response-body deadline 8 seconds;
these are separate phases, not an 8-second total-request guarantee. Responses
are limited to 4 KiB. HTTP/1.0 avoids chunked transfer; unexpected transfer
encoding is rejected. Certificate and hostname verification stay enabled.

The bundled [CA file](certs/root_ca.pem) contains Let's Encrypt's official
[ISRG Root X1](https://letsencrypt.org/certs/isrgrootx1.pem) and
[ISRG Root X2](https://letsencrypt.org/certs/isrg-root-x2.pem), retrieved
2026-10-25. If the provider changes its certificate chain, update the trusted
roots from their official source and rebuild; do not disable verification.

Weather data by [Open-Meteo.com](https://open-meteo.com/), under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Display values are
rounded and condition names abbreviated. The free service permits personal
noncommercial use under its [terms](https://open-meteo.com/en/terms) and
[attribution requirements](https://open-meteo.com/en/licence); commercial use
requires a suitable plan. This firmware displays the provider URL and prints
its credit on serial.

## Software verification

From the repository root, after building to install ArduinoJson:

```sh
c++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I firmware/weather-station/weather_station_online/.pio/libdeps/lolin_s2_mini/ArduinoJson/src \
  firmware/weather-station/tests/weather_online_test.cpp -o /tmp/weather_online_test
/tmp/weather_online_test firmware/weather-station/tests/fixtures/berlin_weather.json
```

The fixture is synthetic. Checks cover valid/invalid payloads, cache age,
retry timing, LCD formatting, sensor errors and both Berlin DST transitions.
The same parser can check a saved live response:
`/tmp/weather_online_test --validate /path/to/response.json CURRENT_UNIX_SECONDS`.
CI also runs `scripts/weather-station.test.ts` and the parser test above. The imported historical
upload record is not evidence for this integrated firmware. Board upload, real broker/TLS and
commands, sensor DATA voltage and combined heap/endurance checks remain pending; follow the
[sensor power guidance](../../../hardware/weather-station/docs/WIRING.md#dht11--connect-by-printed-labels).
The adjacent [LCD-only test](../weather_station_lcd_test/README.md) holds a
fixed message to help check the display; uploading it replaces the running
weather program until this project is uploaded again.
