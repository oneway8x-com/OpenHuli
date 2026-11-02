#pragma once
#include "Arduino.h"
#define U8G2_R0 0
#define U8X8_PIN_NONE 255
static const uint8_t u8g2_font_5x7_tr[] = {0};
struct U8G2_SH1106_128X64_NONAME_1_HW_I2C {
  bool injectTimeout = false;
  unsigned long pages = 0;
  uint8_t page = 0;
  U8G2_SH1106_128X64_NONAME_1_HW_I2C(uint8_t, uint8_t) {}
  void setI2CAddress(uint8_t address) { assert(address == 0x78); }
  void setBusClock(unsigned long) {}
  void begin() {}
  void firstPage() { page = 0; }
  bool nextPage() { if (injectTimeout) Wire.timeout = true; ++pages; return ++page < 8; }
  void setFont(const uint8_t *) {}
  void setCursor(uint8_t, uint8_t) {}
  template<typename T> void print(T) {}
  void setDrawColor(uint8_t) {}
  void drawRBox(uint8_t, uint8_t, uint8_t, uint8_t height, uint8_t) { assert(height > 0); }
  void drawBox(uint8_t, uint8_t, uint8_t, uint8_t) {}
  void drawTriangle(uint8_t, uint8_t, uint8_t, uint8_t, uint8_t, uint8_t) {}
};
