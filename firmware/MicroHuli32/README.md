# MicroHuli32 — ESP32-C3 SuperMini

MicroHuli32 replaces the classic Arduino Nano and Nano shield with an
**ESP32-C3 SuperMini (4 MB flash)** and a matching GPIO expansion board. Open
`MicroHuli32.ino` in Arduino IDE or this folder as a PlatformIO project in VS Code.
The [Nano project](../MicroHuli/README.md) remains available separately; reuse
its robot body, four servos, SH1106 OLED and ELEGOO infrared remote.

This port retains the current Nano gait, rear-servo direction correction,
poses, tricks, expressive eyes and local USB/infrared command map. Servos stay
detached on boot, including when no USB host or OLED is present. It uses four
50 Hz, 14-bit hardware PWM channels through ESP32Servo, with 1000–2000 µs pulses.
`STOP` detaches all channels; a reported servo-attachment failure cancels motion.

Wi-Fi, Bluetooth control and the Nano's optional OpenHuliSerial connection are
not implemented in this project. The ESP32-C3 hardware supports Wi-Fi and BLE,
but this sketch runs locally without credentials or a network connection.

## Wiring

These are **GPIO numbers printed on the SuperMini/expansion board**, not Nano
pin numbers. Check the expansion board's signal, voltage and ground labels;
do not assume the three-pin header order. Leg order is from the robot's
viewpoint, looking forward. The mapping is defined in [board_config.h](board_config.h).

| Connection               | Old Nano pin          | SuperMini GPIO / connection                                |
| ------------------------ | --------------------- | ---------------------------------------------------------- |
| Front-left servo signal  | D3                    | **GPIO3**                                                  |
| Front-right servo signal | D5                    | **GPIO4**                                                  |
| Back-left servo signal   | D6                    | **GPIO5**                                                  |
| Back-right servo signal  | D7                    | **GPIO6**                                                  |
| OLED SDA                 | A4                    | **GPIO0**                                                  |
| OLED SCL                 | A5                    | **GPIO1**                                                  |
| OLED VCC                 | Module dependent      | **3V3**, for a 3.3 V-compatible module                     |
| OLED GND                 | GND                   | **GND**                                                    |
| KY-022 receiver S/OUT    | D2                    | **GPIO10**, 3.3 V logic only                               |
| KY-022 VCC               | 5V                    | **3V3 only if the receiver module supports it**; see below |
| KY-022 GND               | GND                   | **GND**                                                    |
| Servo red wires          | External servo supply | Suitable regulated **5 V servo supply**                    |
| Servo brown/black wires  | Common GND            | Servo supply negative and **board GND**                    |

GPIO2, GPIO8 and GPIO9 are boot-strapping pins; GPIO18/19 are reserved here
for native USB and GPIO20/21 for UART. Infrared LED feedback is disabled so the
decoder does not drive the SuperMini's onboard LED on a boot-strapping pin.
See [Espressif's C3 hardware guidelines](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/schematic-checklist.html).

**ESP32-C3 GPIO is 3.3 V logic.** Do not carry over the Nano's 5 V signal wiring.
Use OLED pull-ups to 3.3 V. A receiver that requires 5 V needs appropriate
level shifting on OUT before GPIO10; do not assume the KY-022 module produces
a safe signal just because its supply is supported. Verify the actual module
voltage requirements and reception before attaching the legs.

## Power: choose USB or external supply

The owner-supplied [DUBEUYEW SuperMini/expansion-board listing](https://www.amazon.de/dp/B0FQSDF7PK)
instructs users to choose **USB or external power, never both**. The following
procedure follows that instruction; the expansion board's circuit has not
been independently verified.

1. **Programming / USB checks:** disconnect the external supply and battery
   completely, leave servo power disconnected, then connect USB. Upload, inspect
   `HELP`/`STOP`, and check the OLED. Never power four servos from USB or 3V3.
2. **Robot operation:** unplug USB first. With power off, connect regulated
   5 V positive to the expansion board's labelled **5V** input and negative to
   **GND / −**. Supply the four servos from a suitably rated 5 V supply, sharing
   ground. Use the infrared remote with USB disconnected.
3. **Return to USB:** switch off and disconnect external power before plugging
   USB back in. Do not rely on a software setting to isolate the supplies.

The listing advertises 3.3–6 V input, but this guide uses regulated 5 V at the
labelled 5V input. Do not connect a raw battery pack to 3V3, assume overvoltage
tolerance on GPIO, or route four-servo current through the SuperMini regulator.
Until the expansion board's V-rail routing and current capacity are verified,
connect servo red wires directly to the servo supply rather than guessing
which jumper or rail carries it. All grounds must join.

## Build and upload

### PlatformIO / VS Code

The pinned environment uses Arduino-ESP32 2.0.17, ESP32Servo 3.2.1, U8g2 2.36.19
and IRremote 4.7.1. The generic `esp32-c3-devkitm-1` target supplies the C3/4 MB
build configuration; [platformio.ini](platformio.ini) explicitly enables native
USB CDC for the SuperMini. It does not use that DevKit's default wiring.

From the repository root:

```sh
pio run --project-dir firmware/MicroHuli32 --environment supermini
# Disconnect external power and servo power before connecting USB.
pio device list
# Replace PORT with the SuperMini's current USB port:
pio run --project-dir firmware/MicroHuli32 --environment supermini --target upload --upload-port PORT
pio device monitor --port PORT --baud 115200
```

Select the `supermini` environment in the PlatformIO extension. A console-only
build without the OLED/IR libraries is available as `supermini_minimal`:

```sh
pio run --project-dir firmware/MicroHuli32 --environment supermini_minimal
```

### Arduino IDE

1. Add `https://espressif.github.io/arduino-esp32/package_esp32_index.json` in
   Preferences → Additional Boards Manager URLs. Install **esp32 by Espressif
   Systems**, version **2.0.17** to match the PlatformIO environment.
2. Select **ESP32C3 Dev Module**, **Flash Size: 4MB**, **Flash Mode: DIO**, and
   **USB CDC On Boot: Enabled**. Use the native USB port.
3. Install **ESP32Servo 3.2.1**, **U8g2 2.36.19** and **IRremote 4.7.1** in Library
   Manager. This project uses `ESP32Servo.h`, not the AVR `Servo.h` library.
4. Open `MicroHuli32.ino` from this folder, keeping `board_config.h` beside it.
   Select the USB port and upload with external/servo power disconnected.
5. Open Serial Monitor at **115200 baud**, with **Newline** ending. Expect
   `MICROHULI32 ready; ESP32-C3; FL3 FR4 BL5 BR6; rear reversed; idle`.

If the USB connection repeatedly disappears or uploading cannot start: hold
**BOOT**, tap **RESET**, then release **BOOT**. Alternatively hold **BOOT** while
connecting USB, then release it. Select the new port, upload, then tap RESET
if necessary. Always disconnect external power first.

The optional `MICROHULI_OLED=0` and `MICROHULI_IR=0` build defines disable their
respective peripherals. A missing OLED is detected at startup and does not
block commands. Battery startup does not wait for a USB serial connection.

## Controls and first checks

USB commands and infrared keys call the same handler. See the full
[command and remote tables](../MicroHuli/README.md#elegoo-infrared-remote).

| USB command                                     | ELEGOO key          | Action                                                     |
| ----------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| `STOP`, `S` or immediate `!`                    | FUNC/STOP           | Detach all servo outputs                                   |
| `TESTFL`, `TESTFR`, `TESTBL`, `TESTBR`          | ST/REPT cycles legs | One leg, eight small sweeps, then detach                   |
| `UP`                                            | 0                   | Centre and hold                                            |
| `DOWN`                                          | 1                   | Full-range 180/0/180/0 logical pose; check clearance first |
| `WALK` / `FORWARD`, `BACK`                      | 2, 3                | Continuous forward/backward gait                           |
| `LEFT`, `RIGHT`, `SL`, `SR`                     | 4, 5, 6, 7          | Turn or spin continuously                                  |
| `REST`                                          | 8                   | Full-range down pose, then detach                          |
| `INFO`                                          | 9 / POWER           | Sit and show uptime/servo angles                           |
| `PUSHUPS`, `SWING`, `GALLOP`                    | VOL+, VOL−, PLAY    | Finite tricks                                              |
| `F`, `B`                                        | Fast forward/back   | Two gait cycles, centre, detach                            |
| `HAPPY`, `ANGRY`, `TIRED`, `CURIOUS`, `DEFAULT` | EQ cycles moods     | Change eyes                                                |
| `HELP` / `?`                                    | Up arrow            | Print help over USB                                        |

A single gait key press starts continuous motion; releasing the key does not
stop it. FUNC/STOP cancels it. Check remote STOP with the robot supported and
feet clear before floor walking. Start with isolated leg tests in external-power
mode. Preserve the Nano's existing mechanical tuning unless the mounts change;
adjust directions, trims and travel limits in the sketch for a different assembly.

## Verification

```sh
sh firmware/MicroHuli32/tests/run_host_tests.sh
```

Host tests run the existing full local-control regressions against the actual
C3 sketch with the OLED present and absent, plus C3 pin/PWM/timeout and PWM
attachment-failure checks. Firmware cross-builds check real ESP32 headers and
libraries. Neither establishes expansion-board power routing, physical pulse
timing, remote reception, servo clearance or loaded walking stability.
