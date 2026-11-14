#pragma once
#include "Arduino.h"
struct TestWire {
  bool connected = false;
  bool timeout = false;
  int sda = -1;
  int scl = -1;
  uint16_t timeoutMs = 0;
  bool getWireTimeoutFlag() { return timeout; }
  void clearWireTimeoutFlag() { timeout = false; }
  void begin() {}
  void begin(int dataPin, int clockPin) { sda = dataPin; scl = clockPin; }
  void setTimeOut(uint16_t ms) { timeoutMs = ms; }
  void setWireTimeout(unsigned long, bool) {}
  void beginTransmission(uint8_t address) { assert(address == 0x3C); }
  uint8_t endTransmission() { return connected ? 0 : 2; }
};
extern TestWire Wire;
