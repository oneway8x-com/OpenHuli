// Exercise the standalone sketch with present/absent display and simulated time.
#include "stubs/Arduino.h"
#include "stubs/Wire.h"
#include <iostream>
unsigned long testTime = 0;
TestSerial Serial;
TestWire Wire;
#define A0 14
#define OUTPUT 1
static bool configured[20] = {};
static bool writtenLow[20] = {};
void testPinMode(uint8_t pin, uint8_t mode) {
  assert(pin < 20 && mode == OUTPUT);
  configured[pin] = true;
}
void testWrite(uint8_t pin, uint8_t level) {
  assert(pin < 20 && level == LOW); // No HIGH/servo pulses are permitted.
  writtenLow[pin] = true;
}
unsigned long micros() { return testTime * 1000; }
int analogRead(uint8_t pin) { assert(pin == A0); return 512; }
static uint32_t rng = 1;
void randomSeed(unsigned long seed) { rng = seed ? seed : 1; }
long random(long limit) { rng = rng * 1664525UL + 1013904223UL; return rng % limit; }
long random(long low, long high) { return low + random(high - low); }
#define pinMode testPinMode
#define digitalWrite testWrite
#include "../firmware/oled_eyes_test/oled_eyes_test.ino"

int main(int argc, char**) {
  Wire.connected = argc > 1;
  setup();
  assert(Serial.baud == 115200);
  for (uint8_t pin : SERVO_SIGNALS) assert(configured[pin] && writtenLow[pin]);
  bool seen[MOOD_COUNT] = {};
  unsigned changes = 0;
  unsigned long lastChange = 0;
  for (unsigned i = 0; i < 50000; ++i) {
    const Mood before = mood;
    const Mood beforeFrame = frameMood;
    const bool wasDrawing = drawing;
    testTime += 10;
    loop();
    assert(gaze >= -5 && gaze <= 5);
    if (wasDrawing) assert(frameMood == beforeFrame);
    if (mood != before) {
      assert(testTime - lastChange >= MOOD_INTERVAL_MS);
      assert(testTime - lastChange <= MOOD_INTERVAL_MS + 80);
      lastChange = testTime;
      ++changes;
    }
    seen[mood] = true;
  }
  if (Wire.connected) {
    assert(oledReady && oled.pages > 100);
    assert(changes > 150);
    for (bool value : seen) assert(value);
    assert(Serial.output.find("OLED ready") != std::string::npos);
  } else {
    assert(!oledReady && oled.pages == 0 && changes == 0);
    assert(Serial.output.find("OLED absent at 0x3C") != std::string::npos);
  }
  std::cout << "PASS OLED random eyes, frame stability and inactive servo signals; display "
            << (Wire.connected ? "present" : "absent") << "\n";
}
