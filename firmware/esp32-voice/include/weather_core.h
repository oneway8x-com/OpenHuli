#pragma once
#include <OpenHuliProtocol.h>
namespace openhuli::weather {
using namespace openhuli::device;
struct Pulse {
  bool high;
  uint16_t micros;
};
Reading decode_dht11(const Pulse* pulses, size_t count);
} // namespace openhuli::weather
