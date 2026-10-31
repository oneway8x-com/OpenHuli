# Preserved clock variant

This is the earlier room-reading/date-time firmware. Its GPIO map in `include/config.h`
differs from the current station: DHT=1, LCD RS=2, E=3, D4=4, D5=5, D6=6, D7=7.
Do not upload it onto the current outer-row wiring without deliberately updating that map.

It has no OpenHuli transport. Use the [main station](../weather_station_online/README.md)
for integration. To build this preserved variant from the repository root:

```sh
pio run --project-dir firmware/weather-station/clock
```

For its local clock, copy `include/wifi_config.example.h` to ignored `include/wifi_config.h`
and configure Wi-Fi privately. The room sensor works offline; date/time needs NTP after restart.
The host readout tests cover this variant's error display, cadence, timer wrap and clock formatting.
