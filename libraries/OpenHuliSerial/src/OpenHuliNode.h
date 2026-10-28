#pragma once
#include "OpenHuliWire.h"
namespace openhuli_serial {
using Send = bool (*)(void*, const Frame&);
using Tick = uint32_t (*)(void*);
using Display = Status (*)(void*, const char*);
struct Sensor {
  Metric state;
  int16_t centi;
  Sensor(Metric s = omitted, int16_t v = 0) : state(s), centi(v) {}
};
class Node {
public:
  Node(uint32_t boot, uint8_t sensors, uint8_t display_limit, Send send, Tick tick, void* context,
       Display display = nullptr);
  void poll();
  void feed(uint8_t byte);
  bool publish(Sensor temperature, Sensor humidity);
  bool connected() const { return armed_; }

private:
  void accept(const Frame& frame);
  bool emit(uint8_t kind, const uint8_t* data, uint8_t size);
  void report();
  Decoder decoder_;
  Frame last_;
  Send send_;
  Tick tick_;
  void* context_;
  Display display_;
  uint8_t session_[session_bytes]{};
  uint32_t boot_, generation_ = 0, challenged_at_ = 0, heard_ = 0, started_ = 0,
                  heartbeat_sequence_ = 0, sequence_ = 0, sample_sequence_ = 0, completed_ = 0;
  uint8_t sensors_, display_limit_;
  Status status_ = unknown;
  bool armed_ = false, offered_ = false, valid_ = false;
};
} // namespace openhuli_serial
