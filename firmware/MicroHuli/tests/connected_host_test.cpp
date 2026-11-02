// Real sketch, AVR wrapper and serial state machines; no cloud or hardware involved.
#include "stubs/Arduino.h"
#include "stubs/Wire.h"
#include "stubs/EEPROM.h"
#include "OpenHuliGateway.h"
#include <iostream>
unsigned long testTime = 100;
TestSerial Serial;
TestWire Wire;
TestEEPROM EEPROM;
#define MICROHULI_CONNECTED 1
#include "../MicroHuli.ino"
using namespace openhuli_serial;
static Status receipt = unknown;
static unsigned receipts = 0;
static uint32_t clockTick(void*) { return testTime; }
static int64_t utc(void*) { return 1767225600000LL + testTime; }
static bool sendFrame(void*, const Frame& frame) {
  uint8_t bytes[max_frame];
  size_t n = encode(frame, bytes);
  Serial.input.append(reinterpret_cast<const char*>(bytes), n);
  return n != 0;
}
static void receivedResult(void*, Status status, int64_t) { receipt = status; ++receipts; }
static void state(void*, bool) {}
int main(int argc, char**) {
  Wire.connected = argc > 1;
  if (argc > 2) EEPROM.bytes[0] = 0; // Corrupt journal must fail closed.
  setup();
  assert(Serial.baud == 19200 && Serial.output.empty());
  Gateway gateway(sendFrame, clockTick, utc, nullptr, 0, 32, nullptr, receivedResult, state);
  auto pump = [&]() {
    for (unsigned i = 0; i < 20; ++i) {
      loop();
      const auto bytes = Serial.output;
      Serial.output.clear();
      for (unsigned char b : bytes) gateway.feed(b);
    }
  };
  uint8_t nonce[16] = {1};
  gateway.begin(nonce);
  gateway.poll();
  pump();
  if (argc > 2) {
    assert(!huli->connected() && !gateway.connected() && !attached);
    std::cout << "PASS MicroHuli corrupt boot journal fails closed\n";
    return 0;
  }
  assert(huli->connected() && gateway.connected());
  assert(gateway.command(false, "", utc(nullptr) + 1000));
  pump();
  assert(receipt == succeeded && receipts == 1);
  // A movement word is displayed literally; duplicates never repeat the draw.
  assert(gateway.command(true, "WALK", utc(nullptr) + 1000));
  const auto duplicate = Serial.input;
  const auto pages = oled.pages;
  pump();
  assert(receipt == (Wire.connected ? succeeded : failed) && receipts == 2);
  assert(oled.pages == pages + (Wire.connected ? 8 : 0));
  Serial.input += duplicate;
  pump();
  assert(oled.pages == pages + (Wire.connected ? 8 : 0));
  assert(!attached && motion == IDLE);
  for (const auto& servo : servos) assert(!servo.enabled && servo.writes == 0);
  if (Wire.connected) {
    oled.injectTimeout = true;
    assert(gateway.command(true, "Uncertain", utc(nullptr) + 1000));
    pump();
    assert(receipt == unknown);
    const auto afterTimeout = oled.pages;
    testTime += 200;
    loop();
    assert(oled.pages == afterTimeout); // No background retry of unknown writes.
  }
  // ASCII console input cannot trigger motion on the binary link.
  Serial.input += "WALK\nDOWN\n!";
  pump();
  assert(!attached && Serial.output.empty());
  // IR STOP remains local and produces no protocol-stream log messages.
  handleCommand("WALK");
  assert(attached);
  handleIRFrame(0, IR_STOP_COMMAND, 0);
  assert(!attached && Serial.output.empty());
  std::cout << "PASS MicroHuli connected ping/display, duplicate suppression and motion isolation\n";
}
