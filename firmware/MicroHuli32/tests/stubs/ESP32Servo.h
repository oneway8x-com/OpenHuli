#pragma once
#include "Arduino.h"
extern int failingServoPin;
class Servo {
public:
  bool enabled = false;
  int output = 90;
  int pin = -1;
  int frequency = 0;
  int timerWidth = 10;
  unsigned long writes = 0;
  void setPeriodHertz(int hz) { frequency = hz; }
  int attach(int gpio, int low, int high) {
    assert(frequency == 50 && low == 1000 && high == 2000);
    pin = gpio;
    timerWidth = 10;
    enabled = gpio != failingServoPin;
    return enabled ? 1 : 0;
  }
  bool attached() const { return enabled; }
  void setTimerWidth(int bits) {
    assert(enabled && bits == 14);
    timerWidth = bits;
  }
  void detach() { enabled = false; }
  void writeMicroseconds(int pulse) {
    assert(enabled && timerWidth == 14 && pulse >= 1000 && pulse <= 2000);
    output = ((pulse - 1000) * 180 + 500) / 1000;
    ++writes;
  }
  void write(int angle) {
    assert(enabled && angle >= 0 && angle <= 180);
    output = angle;
    ++writes;
  }
};
