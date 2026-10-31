# LCD-only test

LOLIN S2 Mini test for the existing outer-row wiring: LCD RS=GPIO3, E=GPIO5,
D4=GPIO7, D5=GPIO12, D6=GPIO33, D7=GPIO35. LCD RW must be GND.
Use the [complete wiring guide](../../../hardware/weather-station/docs/WIRING.md) for power,
contrast, backlight and signal compatibility.

The display holds this message until another firmware is uploaded:

```text
LCD TEST
Hello OpenHuli!
```

From this folder, build/upload with the confirmed board port:

```sh
uvx --with intelhex --from platformio pio run --target upload --upload-port /dev/cu.YOUR_BOARD_PORT
```

USB serial at 115200 repeats the intended message and pin map every two
seconds. Serial output confirms software is running; it cannot confirm that
the physical LCD shows the message. There is no Wi-Fi, sensor reading or
page rotation in this test. The online weather firmware and local Wi-Fi
configuration remain in the adjacent `weather_station_online` project;
upload that project again to restore it.
