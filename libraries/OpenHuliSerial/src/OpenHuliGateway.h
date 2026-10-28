#pragma once
#include "OpenHuliNode.h"
namespace openhuli_serial {
struct LocalSample {
  uint32_t sequence;
  int64_t sampled_at;
  Sensor temperature, humidity;
};
using Utc = int64_t (*)(void*);
using OnSample = void (*)(void*, const LocalSample&);
using OnResult = void (*)(void*, Status, int64_t);
using OnState = void (*)(void*, bool);
// Shared portable local-link gateway for ESP-01 and host-native conformance tests.
class Gateway {
public:
  Gateway(Send send, Tick tick, Utc utc, void* context, uint8_t sensors, uint8_t display,
          OnSample sample, OnResult result, OnState state);
  void begin(const uint8_t nonce[16]);
  void reset();
  void poll();
  void feed(uint8_t byte);
  bool connected() const { return active_; }
  bool command(bool display, const char* text, int64_t expires);

private:
  void accept(const Frame& frame);
  bool send(uint8_t kind, const uint8_t* bytes, uint8_t size);
  Decoder decoder_;
  Send send_;
  Tick tick_;
  Utc utc_;
  void* context_;
  OnSample sample_;
  OnResult result_;
  OnState state_;
  uint8_t session_[24]{}, nonce_[16]{}, sensors_, display_;
  uint32_t probe_at_ = 0, heard_ = 0, sent_at_ = 0, anchor_tick_ = 0, anchor_mono_ = 0,
           acknowledged_ = 0, heartbeat_sequence_ = 0, sequence_ = 0, sample_sequence_ = 0,
           uncertainty_ = 0;
  int64_t anchor_utc_ = 0, expires_ = 0;
  bool active_ = false, pending_ = false, probing_ = false, enabled_ = false, offered_ = false;
};
} // namespace openhuli_serial
