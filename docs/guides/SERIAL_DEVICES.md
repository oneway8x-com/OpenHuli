# Uno/Nano over USB or ESP-01 Wi-Fi

One small [OpenHuliSerial library](../../libraries/OpenHuliSerial/README.md) supports classic
ATmega328P Uno R3 and Nano. Networking remains on either a computer USB bridge or a standalone
ESP-01 gateway. Current ESP32 direct clients are unchanged. AVR has no cloud credentials or TLS
stack. Both routes use the [same local protocol](../protocol/serial-v1.md).

**Status:** cross-compiled examples and native/PTY/TLS tests are available. Physical UART/TLS,
sensor/display, power-cut, memory-under-load and one-hour acceptance remain unverified and must
be recorded before claiming hardware support. No attached board was flashed by this implementation.

## Pair and select the route

Pair **Sensor node (Uno / Nano)** in the existing owner console. Ping is required; select only real
temperature/humidity/display capabilities. Display supports at most 32 printable ASCII characters.
The Node example is ping-only; Sensors uses both metrics and reports unavailable until you supply
a driver. Store the one-time MQTT pairing response privately. No voice/provider key is required.

Use one active route per paired device. Stop the previous gateway before switching. Keep the
computer fence / ESP flash dispatch journal across resets and credential rotation. An uncertain
command is investigated through existing server outcomes; it is never migrated or retried by a
route switch. A physical cable/port is not cryptographic attestation of the AVR.

## Arduino / PlatformIO companion

```sh
python3 scripts/package-arduino-client.py --library OpenHuliSerial --output /tmp/OpenHuliSerial.zip
```

Install that ZIP through Arduino IDE's Add .ZIP Library; select Uno or classic Nano and open the
Node or Sensors example. No ArduinoJson/MQTT dependency is installed on AVR. For PlatformIO:

```sh
pio run --project-dir libraries/OpenHuliSerial/examples/Node
pio run --project-dir libraries/OpenHuliSerial/examples/Sensors
```

Both projects build Uno and Nano environments. The default Stream is `Serial`, 19200 baud. Poll
frequently and keep driver callbacks bounded. Do not print debug messages on the protocol Stream.
The same API can wrap a confirmed hardware or software UART for ESP-01; alternate pins/baud and
SoftwareSerial performance require separate hardware checks. USB hardware Serial and ESP-01 must
not drive the same UART simultaneously.

`allocateBoot()` reserves EEPROM bytes 0–15 by default; choose another unused base if your sketch
uses those bytes. A corrupt/partial journal fails closed. Repair/reset it only during explicit
quiescent reprovisioning after investigating uncertain work, never automatically after a reboot.
The minimal Node example's static RAM and flash are reported by the cross-build. Linker memory
is not evidence of actual stack/heap margin with your sensor/display drivers.

## USB computer bridge

Requires the root Node/pnpm versions, built packages and an explicitly chosen serial port:

```sh
pnpm install --frozen-lockfile
pnpm build:packages
chmod 600 PRIVATE_PAIRING_JSON
pnpm bridge:serial --port PORT --config PRIVATE_PAIRING_JSON --mqtt mqtts://BROKER_HOST:8883 --state PRIVATE_STATE_FILE --ca TRUSTED_CA_PEM
```

`--ca` may be omitted for the system trust store. No plaintext/insecure option exists. `--baud`
defaults to 19200. Configuration is a locally saved console issuance response, not a Tenant claim.
The CLI uses no new environment variables, database connection or AI provider. Secrets do not go
in command arguments; filenames and the public endpoint do. Restrict the state/config directory
and keep state private; configuration and fence files with group/other access are rejected on Unix.

Keep private configuration and state outside the checkout or inside its ignored `.local/` directory.
The state is a tiny atomic, fsynced device-bound expiry watermark, not a command replay queue.
An exclusive `.lock` prevents concurrent local bridges. After a process crash, confirm that no
bridge is running before removing a stale lock. A corrupt or mismatched fence must be investigated,
not silently reset. POSIX directory fsync and serial PTY tests ran on the development host;
Windows/macOS/Linux physical port behavior must each be qualified before broad support claims.

Opening Uno/Nano USB can reset its bootloader. The bridge waits for the actual node handshake;
boot messages or a fixed delay cannot establish readiness. Wrong capability settings prevent the
handshake. Port contention, unplugging, clock faults and broker loss stop the bridge. Restart it
explicitly after recovery; it reloads the fence and rejects stale commands. Ctrl-C closes the
serial/MQTT resources. A supervisor may restart the process with the same private state file.

## ESP-01 standalone gateway

This route uses **dedicated gateway firmware**, replacing stock AT firmware only when you choose
to flash it. ESP-AT v2.3.0.0 MQTT commands do not support MQTT TLS; the gateway instead uses the
ESP8266 Arduino BearSSL client and ArduinoMqttClient with certificate/hostname verification.
There is no plaintext LAN relay and no always-running computer in this route.

Initial build target is a confirmed **1 MiB ESP-01/ESP-01S**, Arduino ESP8266 core 3.1.2 through the
pinned PlatformIO platform. Older/smaller modules and other firmware are not qualified. Verify actual
flash/module identity before choosing a build. Dedicated firmware pin/power choices remain yours.

1. Copy `firmware/esp01-gateway/include/config.example.h` to ignored `config.local.h`.
2. Privately fill Wi-Fi, the assigned MQTT device ID/username/client ID/token, broker endpoint and
   PEM CA. Set `sensors` bit 0 for temperature, bit 1 for humidity, plus the exact display limit.
   These must match the AVR sketch and owner pairing; no permissions are inferred from a claim.
3. Review hardware: appropriate regulated 3.3 V ESP power/current capacity, common ground, level
   translation from 5 V AVR TX, UART contention and boot/reset/programming straps. Do not connect
   5 V Uno/Nano outputs directly to ESP-01 inputs or assume a board's 3.3 V pin can power Wi-Fi.
4. For first, quiescent provisioning only, create the LittleFS image (`pio run --project-dir
firmware/esp01-gateway --target buildfs`) and intentionally upload it along with the configured
   firmware using your verified programmer/port. **Uploading a new filesystem can erase dispatch
   history**; it is not a recovery shortcut for unknown outcomes. The program never auto-formats.
5. Set `enabled=true` only for a confirmed configuration. Default builds are inert. Never upload
   the `esp01_check` image; it only retains code for a credential-free link check.

Build without uploading:

```sh
pio run --project-dir firmware/esp01-gateway --environment esp01_1m --environment esp01_check
```

BearSSL keeps its full default receive capacity; this implementation does not assume the broker
supports reduced TLS fragments. It uses one TLS 1.2 connection, a live CA object, sane UTC and a
monotonic clock guard. UART payloads and commands remain bounded. Clock, identity, storage or
network failures disable dispatch; lost results remain unknown. The dispatch watermark uses a
LittleFS committed rename and readback; its real power-loss/wear behavior requires hardware tests.
Certificate handshake/free-heap/fragmentation/stack, Wi-Fi reconnect under UART traffic, bad CA and
hostname, and one-hour operation all remain required physical qualification. A compiled binary or
successful computer TLS fixture does not establish those results on ESP-01.

## Supported capabilities and tests

Temperature/humidity units and errors match v1. Display callbacks must acknowledge after a driver
finishes; return unknown for uncertain effects. Do not add arbitrary GPIO/relay/servo actions to
frames or bypass registered server tools. Voice/audio, automatic failover, multi-drop discovery,
OTA provisioning and AVR-native TLS are outside this implementation.

```sh
pnpm exec tsx --test scripts/serial-client.test.ts
pnpm exec vitest run --workspace vitest.workspace.ts apps/runtime/src/serial-bridge/__tests__
```

See [ticket #50](https://github.com/oneway8x-com/OpenHuli/issues/50) and the task diary for actual
checks and remaining evidence. Existing authentication, exact-topic ACLs and durable execution
remain server-side; synthetic TLS/PTY tests are not broker-authorization or hardware evidence.
