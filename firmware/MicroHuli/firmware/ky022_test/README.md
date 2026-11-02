# KY-022 / ELEGOO infrared remote test

Standalone test for the classic Arduino Nano. It prints received infrared
protocols, addresses and command codes at 115200 baud. The servo pins D3, D5,
D6 and D7 remain inputs with pull-ups disabled; this sketch sends no servo
pulses. The main robot firmware and OLED face are not running during this test.

## Wiring

Disconnect USB and battery power before connecting the module. Read the labels
on your board instead of assuming a left-to-right pin order.

| KY-022 pin | Nano/shield connection |
| ---------- | ---------------------- |
| S / OUT    | D2 signal pin          |
| + / VCC    | Regulated 5V           |
| - / GND    | GND                    |

Leave external servo power disconnected for this receiver-only test. Power the
Nano and receiver from USB. Point the ELEGOO remote at the receiver and remove
any insulating tab from its battery compartment. Press separate buttons, then
hold one button to check repeat reception.

## Build, upload and monitor

From the Ha-DIYs repository root (check the current Nano USB port first):

```sh
arduino-cli lib install IRremote@4.7.1
arduino-cli compile --fqbn arduino:avr:nano firmware/MicroHuli/firmware/ky022_test
arduino-cli upload --fqbn arduino:avr:nano --port PORT firmware/MicroHuli/firmware/ky022_test
arduino-cli monitor --port PORT --config baudrate=115200
```

`?` prints the startup instructions and counters again; `c` clears counters.
A status line every three seconds confirms the sketch is running. `D2=HIGH`
is an idle reading, not proof that the receiver is connected. A named protocol
and repeatable command code when a key is pressed are evidence of reception.
Record which physical button produced each address/command before mapping
buttons to robot motion. Unknown frames can be noise or unsupported signals.

If no frames arrive, check supply, common ground, the D2 signal connection,
remote battery and line of sight. The onboard LED on some KY-022 variants
flashes when there is activity, but that alone does not prove valid decoding.

## Restore robot firmware

Close the serial monitor with Ctrl+C, then compile and upload the main sketch:

```sh
arduino-cli compile --fqbn arduino:avr:nano firmware/MicroHuli
arduino-cli upload --fqbn arduino:avr:nano --port PORT firmware/MicroHuli
```

The main robot firmware now supports the full 21-key ELEGOO map, including
press-2 to WALK and FUNC/STOP to STOP; see the
[main README](../../README.md#elegoo-infrared-remote). This standalone sketch
remains a receiver-only test. Build/upload success alone does not establish
physical reception. IRremote 4.7.1 was used for this test.

## Observed result — 2026-10-29

Compiled for `arduino:avr:nano`: 11,004 bytes flash, 407 bytes static RAM.
The source receiver test was previously uploaded to a CH340 Nano; startup and periodic
status output were read back at 115200 baud. The owner then confirmed pressing
1, 2 and 3 on the ELEGOO remote, followed by a held key. The received stream
contained these NEC frames, all at address `0x00`:

| Physical key, following the requested press sequence | Command | Raw data     |
| ---------------------------------------------------- | ------- | ------------ |
| 1                                                    | `0x0C`  | `0xF30CFF00` |
| 2                                                    | `0x18`  | `0xE718FF00` |
| 3                                                    | `0x5E`  | `0xA15EFF00` |

The capture reached 8 decoded frames, including 4 repeat frames, with zero
unknown frames and zero buffer overflows. Key 1 appeared twice before keys
2 and 3. This verifies reception and repeat decoding for these keys; other
keys and remote-controlled robot motion were not tested in this capture. The
main robot firmware was subsequently updated with the full command map; the
standalone receiver sketch can be uploaded again for diagnosis.

References: [KY-022 module wiring](https://sensorkit.joy-it.net/en/sensors/ky-022),
[IRremote library and examples](https://github.com/Arduino-IRremote/Arduino-IRremote).
