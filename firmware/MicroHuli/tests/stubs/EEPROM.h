#pragma once
#include "Arduino.h"
struct TestEEPROM {
  uint8_t bytes[16];
  TestEEPROM() { std::fill(bytes, bytes + 16, 255); }
  int length() const { return 16; }
  uint8_t read(uint16_t i) const { return bytes[i]; }
  void update(uint16_t i, uint8_t v) { bytes[i] = v; }
};
extern TestEEPROM EEPROM;
