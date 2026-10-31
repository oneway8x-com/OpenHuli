# First hardware test — ESP32-S2 Mini + LCD1602A + DHT11

Use [the wiring table and diagram](WIRING.md). This test is USB-powered and
offline. The battery, charger and rocker switch must remain disconnected.

## Before connecting power

1. Unplug USB-C. Remove the cell from the assembly or keep it separately
   insulated; do not connect it to either 3V3 or VBUS.
2. Match the actual S2 Mini V1.0.0 labels to the manufacturer's schematic.
   Use only J2/J3, the two outer rows. Leave both inner rows empty.
3. Check every LCD contact against the complete 16-pin table. Pins 7–10
   must be unused; RW (pin 5) must be permanently grounded. VO (pin 3)
   also goes to GND for this initial no-potentiometer test.
4. Verify that VBUS reaches only LCD VDD and the backlight supply path,
   not any GPIO or DHT11 supply. Check the LCD's 3.3V input compatibility.
   Use a suitable buffer if the actual controller requires one.
5. Inspect the LCD backlight circuit. Unless appropriate onboard current
   limiting is confirmed, include the 220Ω series resistor on LED+.
6. Read the DHT11's printed labels. The actual physical order is **not
   confirmed**: `S,+,−` and `+,OUT,−` are different. DATA goes to GPIO37,
   VCC to 3V3, and GND to common GND. Verify its 3.3V supply suitability.
7. Inspect for a DATA pull-up. Add 4.7kΩ–10kΩ between DATA and 3V3 only
   if needed; never put it in series or connect it to VBUS.
8. Inspect exposed wire ends, reversed plugs and possible shorts. With
   power disconnected, use resistance/continuity mode if available to
   check VBUS-to-GND and 3V3-to-GND. Capacitors can cause a brief transient
   indication; a persistent near-zero resistance needs investigation.
   Never use resistance mode on a powered circuit.

## Power and upload

9. Connect a USB-C **data** cable to the ESP32. If anything heats unusually
   or smells wrong, disconnect immediately and inspect the wiring.
10. If available, use a multimeter in DC voltage mode to check VBUS is
    approximately 5V and 3V3 approximately 3.3V relative to common GND.
    Avoid slipping a probe across adjacent sockets. Confirm sensor DATA
    is not pulled above the 3.3V rail. These measurements have not been
    performed as part of the software build.
11. Use one of the upload methods below. Select the **actual current port**;
    it can change between bootloader and running firmware.
12. Open Serial Monitor at **115200 baud**. Press RESET to see startup again.
    The LCD should show this for about two seconds:

    ```text
    Weather Station
    Starting...
    ```

13. After warm-up, a successful sample should show readings such as:

    ```text
    Temp: 23.0 C
    Humidity: 45%
    ```

    Numbers here are examples. Values update about every two seconds.
    Logs include both readings and an uptime timestamp. The sketch writes
    only changed, padded rows and does not repeatedly clear the LCD.

14. Bring a hand near the sensor without blocking or touching its grille.
    Wait several samples for a modest temperature change; this is a
    response check, not calibration. Do not use a flame, hot air gun,
    water or direct breath as a calibration source.
15. To check failure handling, **unplug USB first**, disconnect sensor DATA,
    then reconnect USB. Expect `DHT11 ERROR` / `Check wiring` and a useful
    serial message. Power off before restoring DATA, then power on and
    verify normal readings return. The code retries every two seconds;
    no invalid or previous sample is shown as a current measurement.
16. Close Serial Monitor and verify the LCD still updates. Test in the
    open enclosure first; later compare against a reference after warm-up.

## PlatformIO — existing project toolchain

From the repository root, use this **separate test project**:

```sh
cd firmware/weather-station/weather_station_test
uvx --with intelhex --from platformio pio pkg install
uvx --with intelhex --from platformio pio run
uvx --with intelhex --from platformio pio device list
```

The pinned dependencies install automatically: LiquidCrystal 1.0.7, Adafruit
DHT sensor library 1.4.7 and Adafruit Unified Sensor 1.1.15. The target is
`lolin_s2_mini`, Arduino framework, Espressif32 platform 7.1.3. If `pio` is
already installed, it can replace the `uvx --with intelhex --from platformio
pio` prefix in these commands.

Replace `/dev/cu.YOUR_BOARD_PORT` below with the port listed for your board:

```sh
uvx --with intelhex --from platformio pio run --target upload --upload-port /dev/cu.YOUR_BOARD_PORT
uvx --with intelhex --from platformio pio device monitor --port /dev/cu.YOUR_BOARD_PORT --baud 115200
```

Run these in the diagnostic folder. The sibling `clock` project builds the
preserved Wi-Fi clock firmware with its earlier pin map. The actual `.ino`
is compiled by this test project's `src_dir`/source-filter configuration.
This task verifies compilation, not upload or attached hardware operation.

## Arduino IDE alternative

1. Add Espressif's official board URL in Preferences → Additional Boards
   Manager URLs if needed:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
2. In Boards Manager, install **esp32 by Espressif Systems**; select
   **LOLIN S2 Mini** for the actual ESP32-S2 board.
3. Open `firmware/weather-station/weather_station_test/weather_station_test.ino`; keep
   `display_state.h` in the same sketch folder.
4. In Library Manager install **LiquidCrystal by Arduino**, **DHT sensor
   library by Adafruit**, and **Adafruit Unified Sensor**. If using Arduino
   CLI for library installation, the equivalent pinned command is:

   ```sh
   arduino-cli lib install "LiquidCrystal@1.0.7" "DHT sensor library@1.4.7" "Adafruit Unified Sensor@1.1.15"
   ```

5. Select **USB CDC On Boot → Enabled** and **Upload Mode → Internal USB**
   where those options are exposed by your board/core version. Use CDC for
   serial logging, not DFU-only mode. The PlatformIO board definition already
   sets native USB CDC and USB-OTG mode for this board.
6. Select the current USB port, Verify, then Upload. After first upload,
   press RESET if necessary; reselect the application port for the monitor.

The sketch rejects a non-ESP32-S2 target or disabled native USB CDC at compile
time. This prevents accidental use of UART RX on GPIO37, which is assigned
to the DHT11 in this test.

If the board will not enter download mode, hold BOOT (GPIO0), press and
release RESET, release BOOT, and list ports again. Close any other serial
monitor before uploading. These settings follow [Espressif's USB CDC guide](https://docs.espressif.com/projects/arduino-esp32/en/latest/tutorials/cdc_dfu_flash.html).

## Troubleshooting

| Symptom                        | Checks                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No backlight                   | VBUS/GND, LED polarity, series resistor and actual backlight circuit; backlight is separate from LCD logic                                                     |
| Backlight on, no characters    | VO-to-GND contact, LCD VDD, correct pin-1 numbering, RS/E/D4–D7 labels and 3.3V input compatibility                                                            |
| One row of black blocks        | Usually powered but not initialized, or excessive contrast: verify upload, exact six GPIO wires, common GND and RW-to-GND; a potentiometer may be needed later |
| Garbled/intermittent display   | Loose jumpers, data-line order, supply stability and controller input thresholds; keep leads short                                                             |
| `DHT11 ERROR`                  | Recheck actual sensor labels, VCC=3V3, DATA=GPIO37, common GND, pull-up placement and 3.3V support; do not move the sensor supply to 5V as a shortcut          |
| No serial port                 | Use a data-capable cable, check BOOT/RESET procedure and board selection, then enumerate ports again                                                           |
| Port exists but no serial text | Enable USB CDC, use 115200 baud, reselect the application port and reset; the sketch intentionally does not wait for a monitor                                 |
| Build fails on `intelhex`      | Use the documented `uvx --with intelhex --from platformio pio ...` prefix                                                                                      |

## Software checks and physical limits

The host check exercises startup text, full-width rows, two-second cadence,
timer rollover, invalid/NaN/infinite samples, error messages and recovery:

```sh
cd firmware/weather-station
c++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  tests/hardware_test_display_test.cpp -o /tmp/weather_station_offline_test
/tmp/weather_station_offline_test
```

Compilation cannot confirm the actual pin order, voltage levels, onboard
resistors, contrast, mounting fit or sensor accuracy. Keep all such physical
checks pending until performed. No battery-power, charging or network test
is included.
