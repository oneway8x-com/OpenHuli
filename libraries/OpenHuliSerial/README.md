# OpenHuliSerial

A small, heap-free hot-path client for classic Uno R3 and Nano ATmega328P. Your sensor/display code
uses the same Arduino `Stream` API through a USB computer bridge or an ESP-01 UART Wi-Fi gateway.
Credentials, JSON, MQTT and TLS stay off the AVR. See the [complete setup guide](https://github.com/oneway8x-com/OpenHuli/blob/main/docs/guides/SERIAL_DEVICES.md)
and [wire protocol](https://github.com/oneway8x-com/OpenHuli/blob/main/docs/protocol/serial-v1.md).

```cpp
#include <OpenHuliSerial.h>
// In setup, after Serial.begin(19200):
static openhuli_serial::OpenHuliSerial node(Serial, openhuli_serial::allocateBoot(), 3);
// In loop, call node.poll() frequently. Publish only actual driver values:
// node.publish({openhuli_serial::measured, measuredCentiCelsius},
//              {openhuli_serial::read_failed});
```

The constructor takes Stream, durable boot generation, sensor flags (1 temperature, 2 humidity),
display limit (0–32), optional display callback and callback context. `poll()` processes bounded
input and lease expiry. `publish(Sensor, Sensor)` uses integer hundredths and the real sample tick;
it returns false when offline, invalid or not sent. Sensor states are omitted, measured, read_failed
and unavailable. A declared error never becomes a measurement.

For a display, pass a nonzero limit and a `Status(void*, const char*)` callback returning succeeded,
failed, unsupported or unknown after the physical operation. Keep callbacks synchronous and bounded;
there is one command at a time. The library reserves command identity before the callback, checks
expiry and suppresses duplicates. It cannot guarantee exactly-once physical effects across a crash.
Never replay unknown work after reset.

`allocateBoot(base=0)` reserves 16 EEPROM bytes. It advances a two-slot CRC/commit journal and fails
closed on corruption/readback failure/exhaustion. Preserve it across firmware changes. It is not a
hardware identity or a cloud credential. The library itself never erases EEPROM.

Package with `python3 scripts/package-arduino-client.py --library OpenHuliSerial --output /tmp/OpenHuliSerial.zip`
from the repository root, then install using Arduino IDE Add .ZIP Library. PlatformIO examples under
`examples/Node` and `examples/Sensors` have Uno/Nano environments. Node is ping-only; Sensors reports
unavailable until a real driver is supplied. The same Stream may be a separately qualified software
UART; no board pins or module power setup are selected by this library.

The portable `OpenHuliGateway.h` is the local-link gateway state machine used by ESP-01 and native
conformance tests. It has no MCU networking dependency. Cloud authority and physical completion
must still be validated by its adapter. `OpenHuliSerial.h` is the AVR Arduino wrapper.

Cross-builds/native/PTY/TLS fixtures are available. Physical boards, module power/logic levels,
serial timing, EEPROM power cuts, heap/stack and one-hour network operation remain unverified.
Do not infer physical support from compilation alone.
