# Hardware projects

Keep one stable device name shared across `hardware/<device>` and `firmware/<device>`.

- `hardware/<device>` owns wiring, components, enclosure sources and assembly guidance.
- `firmware/<device>` owns buildable applications, private configuration examples, diagnostics and tests.
- `libraries/` owns reusable device clients and protocols. Applications consume these libraries.
- `docs/guides/` owns cross-device OpenHuli pairing, transport and operator instructions.

Keep device-specific variants together with explicit names and pin-map warnings. Commit source
and useful small reference images. Generate CAD/print/PDF exports locally; avoid duplicate folders,
build output, private configuration and raw runtime logs. Record actual verification in task diaries.

The first imported project is the [weather station](weather-station/README.md).
