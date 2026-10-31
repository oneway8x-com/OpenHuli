#pragma once
#include <algorithm>
#include <cstdint>
#include <string>
#include <cassert>
#define F(value) value
#define PI 3.14159265358979323846
#define TWO_PI (2 * PI)
#define LOW 0
#define constrain(value, low, high) ((value) < (low) ? (low) : ((value) > (high) ? (high) : (value)))
using std::min;
extern unsigned long testTime;
inline unsigned long millis() { return testTime; }
inline void digitalWrite(uint8_t, uint8_t) {}
inline void noInterrupts() {}
inline void interrupts() {}
struct Stream {
  virtual int available() const = 0;
  virtual int read() = 0;
  virtual size_t write(const uint8_t*, size_t) = 0;
  virtual ~Stream() {}
};
struct TestSerial : Stream {
  std::string input;
  std::string output;
  unsigned long baud = 0;
  void begin(unsigned long value) { baud = value; }
  size_t write(const uint8_t* bytes, size_t count) {
    output.append(reinterpret_cast<const char*>(bytes), count);
    return count;
  }
  int available() const { return input.size(); }
  int read() { const unsigned char c = input.front(); input.erase(0, 1); return c; }
  void print(const char *value) { output += value; }
  void println(const char *value) { output += value; output += '\n'; }
  void println(uint8_t value) { output += std::to_string(value); output += '\n'; }
};
extern TestSerial Serial;
