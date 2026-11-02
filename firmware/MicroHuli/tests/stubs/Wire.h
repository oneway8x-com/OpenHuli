#pragma once
#include "Arduino.h"
struct TestWire {
  bool connected = false;
  bool timeout = false;
  bool getWireTimeoutFlag() { return timeout; }
  void clearWireTimeoutFlag() { timeout = false; }
  void begin() {}
  void setWireTimeout(unsigned long, bool) {}
  void beginTransmission(uint8_t address) { assert(address == 0x3C); }
  uint8_t endTransmission() { return connected ? 0 : 2; }
};
extern TestWire Wire;
