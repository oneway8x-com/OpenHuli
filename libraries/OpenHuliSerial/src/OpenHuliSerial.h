#pragma once
#include "OpenHuliNode.h"
#include <Arduino.h>
#include <EEPROM.h>
namespace openhuli_serial {
// EEPROM bytes [base,base+16) are reserved for the boot journal. Initialization fails closed.
inline uint32_t allocateBoot(uint16_t base = 0) {
  struct Store {
    static uint8_t read(void* c, uint16_t i) { return EEPROM.read(*static_cast<uint16_t*>(c) + i); }
    static void write(void* c, uint16_t i, uint8_t v) {
      EEPROM.update(*static_cast<uint16_t*>(c) + i, v);
    }
  };
  if (uint32_t(base) + 16 > uint32_t(EEPROM.length()))
    return 0;
  return next_boot(Store::read, Store::write, &base);
}
class OpenHuliSerial {
public:
  OpenHuliSerial(Stream& serial, uint32_t boot, uint8_t sensors = 0, uint8_t display_limit = 0,
                 Display display = nullptr, void* display_context = nullptr)
      : serial_(serial), display_(display), display_context_(display_context),
        node_(boot, sensors, display_limit, send, clock, this, display ? show : nullptr) {}
  void poll() {
    node_.poll();
    uint8_t count = 0;
    while (serial_.available() && count++ < 96)
      node_.feed(uint8_t(serial_.read()));
  }
  bool publish(Sensor temperature, Sensor humidity) { return node_.publish(temperature, humidity); }
  bool connected() const { return node_.connected(); }

private:
  static uint32_t clock(void*) { return millis(); }
  static bool send(void* c, const Frame& f) {
    auto& self = *static_cast<OpenHuliSerial*>(c);
    uint8_t bytes[max_frame];
    const size_t n = encode(f, bytes);
    return n && self.serial_.write(bytes, n) == n;
  }
  static Status show(void* c, const char* text) {
    auto& self = *static_cast<OpenHuliSerial*>(c);
    return self.display_(self.display_context_, text);
  }
  Stream& serial_;
  Display display_;
  void* display_context_;
  Node node_;
};
} // namespace openhuli_serial
