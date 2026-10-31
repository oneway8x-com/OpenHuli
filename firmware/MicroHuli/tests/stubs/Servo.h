#pragma once
#include "Arduino.h"
class Servo {
public:
  bool enabled = false;
  int output = 90;
  unsigned long writes = 0;
  uint8_t attach(uint8_t, int, int) { enabled = true; return 0; }
  bool attached() const { return enabled; }
  void detach() { enabled = false; }
  void writeMicroseconds(int pulse) { assert(pulse >= 1000 && pulse <= 2000); }
  void write(int angle) { assert(angle >= 0 && angle <= 180); output = angle; ++writes; }
};
