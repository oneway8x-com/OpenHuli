#include <OpenHuliSerial.h>
openhuli_serial::OpenHuliSerial* node = nullptr;
uint32_t sampled = 0;
void setup() {
  Serial.begin(19200);
  static openhuli_serial::OpenHuliSerial client(Serial, openhuli_serial::allocateBoot(), 3);
  node = &client;
}
void loop() {
  node->poll();
  if (node->connected() && uint32_t(millis() - sampled) >= 30000) {
    sampled = millis();
    // Replace with real driver results, e.g. Sensor(measured, measuredCelsius * 100).
    // Until a driver exists, report unavailable; never fabricate readings.
    node->publish(openhuli_serial::Sensor(openhuli_serial::unavailable),
                  openhuli_serial::Sensor(openhuli_serial::unavailable));
  }
}
