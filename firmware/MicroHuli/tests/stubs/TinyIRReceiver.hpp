#pragma once
#include "Arduino.h"
#define IRDATA_FLAGS_IS_REPEAT 0x01
#define IRDATA_FLAGS_PARITY_FAILED 0x04
struct TestTinyIRData {
  uint8_t Address = 0;
  uint8_t Command = 0;
  uint8_t Flags = 0;
  bool justWritten = false;
};
static volatile TestTinyIRData TinyIRReceiverData;
inline bool initPCIInterruptForTinyIRReceiver() { return true; }
