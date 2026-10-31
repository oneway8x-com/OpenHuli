# MicroHuli — Arduino Nano

MicroHuli is a four-servo robot running on a **classic Arduino Nano
(ATmega328P, 5 V)** and a Nano I/O expansion shield. This version uses USB
Serial commands and a SH1106 OLED face. The main sketch is `MicroHuli.ino`.

| Assembled robot                         | Printed parts                       |
| --------------------------------------- | ----------------------------------- |
| ![Assembled robot](robot-assembled.png) | ![Printed parts](printed-parts.png) |

The [original ESP32 sketch and instructions](firmware/esp32_original/README.md)
are preserved separately. The classic Nano has no built-in Wi-Fi or Bluetooth,
so this version omits BLE control, network time, weather, and YouTube statistics.
`INFO` shows uptime, servo output angles and whether servo pulses are enabled.

## Wiring

Leg order is from the robot's viewpoint, facing forward:

| Connection                        | Nano / shield pin                        |
| --------------------------------- | ---------------------------------------- |
| Front-left servo signal           | **D3 / S**                               |
| Front-right servo signal          | **D5 / S**                               |
| Back-left servo signal            | **D6 / S**                               |
| Back-right servo signal           | **D7 / S**                               |
| OLED SDA                          | **A4**                                   |
| OLED SCL                          | **A5**                                   |
| OLED GND                          | **GND**                                  |
| OLED VCC                          | According to the display module's rating |
| KY-022 IR receiver signal (S/OUT) | **D2 / S**                               |
| KY-022 VCC (+)                    | **Regulated 5V**                         |
| KY-022 GND (-)                    | **GND**                                  |

Servo orange/yellow is signal, red is positive supply, and brown/black is
GND. Check the shield's **S / V / G** labels rather than assuming row order.
D0 and D1 remain free for USB Serial.

Supply the servos externally and join supply GND to Nano GND. Do not run four
servos through the Nano's USB power or onboard regulator. For initial testing,
power the Nano through USB and the servos from a separate suitable supply.
Four NiMH rechargeable AAs provide 4.8 V nominal for the servo supply; four
alkaline AAs provide 6 V nominal and should use a suitable regulated 5 V output
for this build. **Do not connect either raw pack to the Nano's 3V3 or 5V pin.**

The exact Hailege shield power routing has not been verified. Until its manual
or circuit is checked, connect servo red wires directly to the external servo
supply rather than guessing which DC socket or jumper feeds the shield's V rail.

Use 5 V for OLED VCC only if the complete module supports 5 V power and I2C
signals. A 3.3 V-only OLED needs an appropriate supply and I2C level shifting.
The configured display is **SH1106, 128x64, I2C address 0x3C**. A missing display
is detected at startup and does not prevent motion commands.

## Build and upload

In Arduino IDE:

1. Install **Arduino AVR Boards** through Boards Manager.
2. Select **Arduino Nano → ATmega328P**. The previously connected Nano accepted
   the standard bootloader option; use Old Bootloader only for a board that needs it.
3. Install **Servo**, **U8g2** and **IRremote** through Library Manager. Versions
   used are Servo **1.3.0**, U8g2 **2.36.19**, IRremote **4.7.1**, and AVR Boards
   **1.8.8**. The main sketch uses IRremote's small `TinyIRReceiver` NEC decoder.
4. Open `MicroHuli.ino`, select the Nano's USB port, then upload.
5. Open Serial Monitor at **115200 baud**, with **Newline** ending.

With Arduino CLI, from this folder:

```sh
arduino-cli lib install Servo@1.3.0 U8g2@2.36.19 IRremote@4.7.1
arduino-cli compile --fqbn arduino:avr:nano .
arduino-cli board list
# Replace PORT with the Nano's current USB port:
arduino-cli compile --fqbn arduino:avr:nano --upload --port PORT .
```

The OLED uses a 128-byte page buffer and simple blinking, expressive eyes to
fit the Nano's 2 KB RAM. This replaces the ESP32 version's RoboEyes renderer.
To build without OLED support or its library, set `MICROHULI_OLED` to `0` at the
start of the sketch, or pass `--build-property build.extra_flags=-DMICROHULI_OLED=0`.

## OpenHuli connection

The default build retains standalone USB commands at 115200 baud. To connect to
OpenHuli, compile with `MICROHULI_CONNECTED=1`. This dedicates USB Serial to the
existing binary OpenHuliSerial protocol at **19200 baud**, disables text input and
logs on that stream, and keeps the infrared controls available locally.
Do not open Serial Monitor while a bridge owns the port.

From the **repository root**, compile without uploading:

```sh
arduino-cli compile --fqbn arduino:avr:nano --library libraries/OpenHuliSerial \
  --build-property build.extra_flags=-DMICROHULI_CONNECTED=1 firmware/MicroHuli
```

For Arduino IDE, first package and install [OpenHuliSerial](../../libraries/OpenHuliSerial/README.md),
then set `MICROHULI_CONNECTED` to `1` at the top of the sketch before compiling.
The library reserves EEPROM bytes **0–15** for its durable boot journal. Preserve
those bytes across firmware changes; a damaged journal disables the link.

Follow the [Uno/Nano setup guide](../../docs/guides/SERIAL_DEVICES.md) to pair
**Sensor node (Uno / Nano)** and run the authenticated USB bridge. Select **ping**
and **display with exactly 32 characters**, with no temperature/humidity sensors.
If compiled with `MICROHULI_OLED=0`, pair with ping only. The configured display
capability remains 32 when an expected OLED is unplugged; display commands then
fail rather than claiming success. Text wraps into two lines of 16 characters.
Text is literal: sending `WALK` displays that word and never moves a servo.
An I2C timeout returns an unknown outcome, which must not be blindly retried.
The sketch reports bus-write completion, not optical verification of the OLED.

Movement, poses, tests and moods remain local USB commands in standalone mode,
or local infrared commands in either build. The current server protocol has no
robot-motion capability. Cloud movement requires a separately designed command
contract and execution policy. This robot has no temperature/humidity driver,
voice transport or cloud credentials. Do not fabricate telemetry to keep it online;
a ping-only connection can become stale under the current backend liveness policy.
Cloud text stays visible until reset. Local motion and STOP still work while text
is visible. Gateway disconnect does not cancel a locally started infrared gait.

The preserved ESP32 sketch is a legacy standalone reference, not the OpenHuli
client. The connected Nano build and its power, timing and loaded gait still need
physical qualification; compiling does not flash the robot.

## ELEGOO infrared remote

The KY-022 receiver uses **D2**, separate from the servo and OLED pins. Follow
the module's S/OUT, +/VCC and -/GND labels; pin order varies between boards.
Disconnect power before wiring. The receiver test confirmed NEC address `0x00`
with key 1 = `0x0C`, key 2 = `0x18`, key 3 = `0x5E`, including repeat frames.

| Remote key                                 | Command / action                                                                     | NEC command     |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | --------------- |
| **0**                                      | `UP`: centre legs and hold                                                           | `0x16`          |
| **1**                                      | `DOWN`: creator's full-range pose, hold                                              | `0x0C`          |
| **2**                                      | `WALK` / `FORWARD`: continuous forward gait                                          | `0x18`          |
| **3**                                      | `BACK`: continuous backward gait                                                     | `0x5E`          |
| **4**                                      | `LEFT`: continuous left turn                                                         | `0x08`          |
| **5**                                      | `RIGHT`: continuous right turn                                                       | `0x1C`          |
| **6**                                      | `SL`: continuous left spin                                                           | `0x5A`          |
| **7**                                      | `SR`: continuous right spin                                                          | `0x42`          |
| **8**                                      | `REST`: creator's down pose, then detach                                             | `0x52`          |
| **9** or **POWER**                         | `INFO`: sit and display status                                                       | `0x4A` / `0x45` |
| **FUNC/STOP**                              | `STOP` / `S` / `!`: detach immediately                                               | `0x47`          |
| **VOL+ / VOL-**                            | `PUSHUPS` / `SWING`                                                                  | `0x46` / `0x15` |
| **PLAY/PAUSE**                             | `GALLOP`                                                                             | `0x40`          |
| **FAST BACK / FAST FORWARD** (`<<` / `>>`) | `B` / `F`: two cycles, then centre and detach                                        | `0x44` / `0x43` |
| **EQ**, press repeatedly                   | Cycle `HAPPY` -> `ANGRY` -> `TIRED` -> `CURIOUS` -> `DEFAULT`, based on current mood | `0x19`          |
| **ST/REPT**, press repeatedly              | Start one `TESTFL` -> `TESTFR` -> `TESTBL` -> `TESTBR` test per press                | `0x0D`          |
| **UP arrow**                               | `HELP` / `?`: print commands to USB Serial                                           | `0x09`          |
| **DOWN arrow**                             | `DEFAULT`: normal eyes                                                               | `0x07`          |

**Press once, then release.** Each key sends the same command as USB Serial.
For 2–7, walking/turning continues until FUNC/STOP or another motion command;
there is no release or signal-loss timeout. Holding the key is unnecessary.
A direction starts with the gait's 700 ms entry period. An eye or HELP command
only changes the eyes or prints help, so it leaves a running gait active.

Repeat frames are ignored except FUNC/STOP, so holding a key does not restart
its action or rapidly advance EQ/ST/REPT. A repeat cannot resume movement after
STOP. Each isolated servo test makes eight small sweeps (~15 seconds) and then
detaches. FUNC/STOP cancels any motion, including Serial-started motion.
Unknown keys, wrong addresses and parity failures leave the current action
unchanged. Boot stays idle. **Key 1 is now DOWN; use FUNC/STOP to stop.**

Keys 1 and 8 use the creator's full-range endpoints as documented below.
INFO also moves to a sitting pose. The arrow keys are separate from the robot's
UP/DOWN pose commands on 0/1.

The profile follows the standard ELEGOO 21-key layout
([manufacturer's key names and legacy codes](https://wiki.elegoo.com/oshw-getting-started-%26-kits/irreceive-uno)).
IRremote's NEC command bytes use LSB-first decoding; the old tutorial's whole
32-bit values must not be substituted for these bytes. **Only keys 1, 2 and 3
have been physically identified on this remote so far.** Other keys use the
standard profile and need checking against the actual handset. Use the
[receiver-only sketch](firmware/ky022_test/README.md) to read differing codes.

IR support adds no receive timer and uses IRremote's small NEC decoder via D2.
Set `MICROHULI_IR=0` to build without this receiver/library. The local-control Nano build uses **22,474 bytes flash and 1,299 bytes static RAM**.
The connected build uses **25,306 bytes flash and 1,563 bytes static RAM**, leaving
**485 bytes** for stack and other runtime use. The compiler flags low remaining
memory; physical stack margin and stability under simultaneous IR/display/motion
load remain unverified.
Host simulations cover all 21 keys, single-press continuous directions,
FUNC/STOP, repeat suppression, mood/test cycles, filtering and Serial commands,
with the OLED both present and absent. They do not establish loaded walking
performance. Earlier hold-to-walk firmware was superseded by this command map.

## Commands

Commands are case-insensitive. Use newline or carriage return after each command.

| Command                                             | Action                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `TESTFL` / `TESTFR` / `TESTBL` / `TESTBR`           | Test only the selected leg: eight small ±5° sweeps (about 15 seconds), center, then disable pulses |
| `F` / `B`                                           | Two forward/backward gait cycles, then center and disable pulses                                   |
| `FORWARD` / `WALK`                                  | Continuous forward gait until another motion command or `STOP`                                     |
| `BACK`                                              | Continuous backward gait until another motion command or `STOP`                                    |
| `LEFT` / `RIGHT`                                    | Continuous left/right turning gait                                                                 |
| `SL` / `SR`                                         | Continuous spin gait                                                                               |
| `STOP` / `S`                                        | Cancel motion and immediately disable servo pulses                                                 |
| `!`                                                 | Immediately stop, without needing a newline                                                        |
| `UP`                                                | Center legs and hold                                                                               |
| `DOWN`                                              | Creator's logical 180° / 0° / 180° / 0° pose, then hold                                            |
| `REST`                                              | Same creator pose, then disable pulses; tired eyes                                                 |
| `INFO`                                              | Sit and show uptime, commanded output angles and servo status                                      |
| `PUSHUPS` / `SWING` / `GALLOP`                      | Finite trick, then return to center and hold                                                       |
| `HAPPY` / `ANGRY` / `TIRED` / `CURIOUS` / `DEFAULT` | Change the eyes without changing motion                                                            |
| `HELP` / `?`                                        | List commands                                                                                      |

On boot, the servos remain detached: there is **no automatic walking or full-travel
REST movement**. Walking, poses and tricks are nonblocking, so STOP can interrupt
them. STOP disables holding torque; support the robot when needed. Commanded
angles and completion messages are software reports, not servo position feedback.

For individual checks, send one `TEST...` command at a time and wait for
`SERVO TEST complete; centered; pulses off` after about 15 seconds. The other three servos remain
detached during the test. Rear output motion follows `SERVO_DIRECTIONS`, so
its small sweep is mirrored. `STOP` or `!` cancels a test immediately.

## Servo configuration

At the top of the sketch:

- `SERVO_PINS`: `{3, 5, 6, 7}`, in FL / FR / BL / BR order.
- `SERVO_DIRECTIONS`: `{1, 1, -1, -1}`. Rear output directions were reversed after
  the owner reported opposite front/rear rotation. Physical walking direction
  still needs confirmation.
- `SERVO_TRIM`: neutral adjustment for each joint, initially all zero.
- `SERVO_MIN` / `SERVO_MAX`: normal motion target bounds, initially 20°–160°.
- Servo pulse range: **1000–2000 microseconds**, matching the Nano test sketches.
- `WALK_OFFSETS`, `WALK_PHASES`, `AMPLITUDE`, `GAIT_CYCLE_MS`: gait tuning.

These software bounds are starting values, not measured mechanical clearance.
Check leg clearance before expanding movement. BACK reverses phase progression;
LEFT/RIGHT use the physical left/right leg pairs. Turning and trick poses have
not been validated on the assembled robot.

At the owner's request, `DOWN` and `REST` use the creator's full-range logical
targets `{180, 0, 180, 0}` and bypass the normal 20°–160° target limits. With
this build's rear reversal and zero trims, the physical output commands are
**FL 180°, FR 0°, BL 0°, BR 180°**. Movement back to `UP` is gradual. The Nano
pulse range remains **1000–2000 microseconds**; the original ESP32 sketch used
its servo library's defaults, so matching command angles does not establish
matching physical leg angles. These endpoints have not been physically checked.

## Larger servo-horn mount

For a leg with extra horn clearance and an enlarged access hole, see the
[revised printable leg and small fit sample](hardware/horn_fit/README.md).
The recess gains 0.4 mm per side and 5 mm in length toward the foot, and the
through-hole is 8 mm; the leg's outside
dimensions stay unchanged. Print the sample first to check your horn.

## Passive shoe prototype

For a removable, four-servo mechanical experiment on hard flat surfaces, see the
[passive shoe prototype and printable files](hardware/feet/README.md). Its fit
and speed benefit still need physical testing.

## Standalone test sketches

- [KY-022 infrared receiver test](firmware/ky022_test/README.md): D2 signal,
  prints ELEGOO remote button codes at 115200 baud; no servo pulses or OLED.
- [Front-left test](firmware/front_left_test/front_left_test.ino): D3 only,
  `t` makes one 90° → 85° → 95° → 90° test, then disables pulses.
- [Back-left test](firmware/back_left_test/back_left_test.ino): D6 only,
  same small movement.
- [Forward test](firmware/nano_forward_test/nano_forward_test.ino): `f` runs
  two cycles with the rear directions reversed, then disables pulses.

These are separate sketches. Uploading one replaces the currently installed
firmware. The STL and pictures are unchanged by the Nano port.

## Software checks

From this folder, run `./tests/run_host_tests.sh` with a C++11 compiler. This exercises the actual
sketch against simulated Serial, time, servo and display interfaces, with the
OLED both present and absent. Checks cover idle startup, bounded steps, STOP
without a position jump, backward phase order, input overflow, interruptible
tricks, individual-servo isolation, and rear inversion. They do not verify electrical power, physical motion
or OLED appearance.

Connected simulations also exercise the real OpenHuliSerial wrapper and gateway:
handshake, ping, display success/failure, duplicate suppression, protocol-stream
isolation, and display text that resembles a movement command.
