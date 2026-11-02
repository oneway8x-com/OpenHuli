# Random OLED eyes test

Standalone **classic Arduino Nano / ATmega328P** diagnostic for the existing
SH1106 128×64 I2C OLED at **0x3C**. It automatically chooses a different
expression every 2.5 seconds: DEFAULT, HAPPY, ANGRY, TIRED or CURIOUS. Eyes also
blink and change gaze. The expression name appears at the bottom of the screen
and is logged over USB Serial at **115200 baud**.

This sketch does not use the Servo or IR libraries. D3, D5, D6 and D7 are held
LOW; no servo pulses or cloud connections are generated. Uploading this test
**replaces the robot firmware** until the main sketch is uploaded again.

## Isolated setup

Use the Nano and OLED on USB power only, with the batteries, servos and other
modules disconnected. Given the reported power fault, do not test a hot,
visibly damaged or shorted board by repeatedly reconnecting it to a computer.

| OLED connection | Classic Nano                                                                          |
| --------------- | ------------------------------------------------------------------------------------- |
| SDA             | A4                                                                                    |
| SCL             | A5                                                                                    |
| GND             | GND                                                                                   |
| VCC             | The module's rated supply; 5 V only for a module supporting 5 V power and I2C signals |

A 3.3 V-only display requires appropriate power and I2C level shifting. The
sketch cannot detect an incorrect voltage rating. Keep power off while wiring.

## Compile and upload

Install the same AVR board core and U8g2 library used by the
[main robot sketch](../../README.md#build-and-upload). Servo and IRremote are
not required for this standalone diagnostic. From the repository root:

```sh
arduino-cli compile --fqbn arduino:avr:nano firmware/MicroHuli/firmware/oled_eyes_test
arduino-cli board list
# Replace PORT with the connected Nano's current USB port:
arduino-cli upload --fqbn arduino:avr:nano --port PORT --verify firmware/MicroHuli/firmware/oled_eyes_test
arduino-cli monitor --port PORT --config baudrate=115200
```

On startup the serial output identifies `MICROHULI_OLED_EYES_TEST`. A successful
I2C probe logs `OLED ready`, followed by `EYES: ...` approximately every 2.5 s.
A missing display logs `OLED absent at 0x3C`; check wiring, controller/address
and power before restarting. An I2C acknowledgment and serial logs do not prove
that the panel renders correctly; inspect the actual screen.

To restore movement and IR control, upload `firmware/MicroHuli/MicroHuli.ino`
using its parent folder as the Arduino CLI sketch path, following the main
project's instructions. Keep the robot power path isolated until its fault is
resolved.

## Software check

The root MicroHuli host test runner also simulates this actual sketch with the
display present and absent. It checks all five expressions over simulated time,
frame stability across OLED pages, bounded gaze, diagnostics, and servo pins
held LOW. These are not physical electrical/display tests.
