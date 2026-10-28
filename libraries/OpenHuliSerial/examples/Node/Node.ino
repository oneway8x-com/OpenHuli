#include <OpenHuliSerial.h>
// The same Stream API works with the USB UART or a confirmed ESP-01 UART adapter.
// Pins/level shifting/power must be checked before attaching an ESP-01.
openhuli_serial::OpenHuliSerial* node = nullptr;
void setup() {
  Serial.begin(19200);
  const uint32_t boot = openhuli_serial::allocateBoot();
  // Allocated once at boot; no hot-path allocation. A zero boot keeps commands disabled.
  static openhuli_serial::OpenHuliSerial client(Serial, boot);
  node = &client;
}
void loop() { node->poll(); }
