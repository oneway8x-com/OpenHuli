#include "OpenHuliGateway.h"
namespace openhuli_serial {
Gateway::Gateway(Send send, Tick tick, Utc utc, void* ctx, uint8_t sensors, uint8_t display,
                 OnSample sample, OnResult result, OnState state)
    : send_(send), tick_(tick), utc_(utc), context_(ctx), sample_(sample), result_(result),
      state_(state), sensors_(sensors), display_(display) {}
bool Gateway::send(uint8_t kind, const uint8_t* bytes, uint8_t size) {
  Frame f;
  f.kind = kind;
  f.size = size;
  if (size)
    memcpy(f.data, bytes, size);
  return send_(context_, f);
}
void Gateway::begin(const uint8_t nonce[16]) {
  reset();
  memcpy(nonce_, nonce, 16);
  enabled_ = true;
}
void Gateway::reset() {
  const bool was = active_;
  active_ = enabled_ = offered_ = probing_ = false;
  decoder_.reset();
  if (pending_) {
    pending_ = false;
    result_(context_, unknown, utc_(context_));
  }
  if (was)
    state_(context_, false);
}
void Gateway::poll() {
  if (!enabled_)
    return;
  const uint32_t now = tick_(context_);
  const int64_t utc = utc_(context_);
  const int64_t drift = utc - (anchor_utc_ + uint32_t(now - anchor_mono_));
  if (active_ && (!utc || uint32_t(now - heard_) >= 3000 ||
                  uint32_t(now - anchor_mono_) >= 3600000 || drift < -1000 || drift > 1000)) {
    reset();
    enabled_ = true;
  }
  if (pending_ && utc >= expires_) {
    pending_ = false;
    result_(context_, unknown, utc);
  }
  if (!active_ && (!probing_ || uint32_t(now - probe_at_) >= 1100)) {
    offered_ = false;
    probe_at_ = now;
    probing_ = true;
    send(probe, nullptr, 0);
  } else if (active_ && uint32_t(now - sent_at_) >= 1000) {
    sent_at_ = now;
    uint8_t bytes[28];
    memcpy(bytes, session_, 24);
    put32(bytes + 24, ++heartbeat_sequence_);
    if (!heartbeat_sequence_ || !send(heartbeat, bytes, sizeof(bytes))) {
      reset();
      enabled_ = true;
    }
  }
}
void Gateway::feed(uint8_t b) {
  if (enabled_ && decoder_.feed(b))
    accept(decoder_.frame());
}
void Gateway::accept(const Frame& f) {
  const uint32_t now = tick_(context_);
  const int64_t utc = utc_(context_);
  if (f.kind == challenge && f.size == 14 && !active_ && probing_ &&
      uint32_t(now - probe_at_) < 1000 && get32(f.data) && get32(f.data + 4) &&
      f.data[12] == sensors_ && f.data[13] == display_) {
    memcpy(session_, f.data, 8);
    memcpy(session_ + 8, nonce_, 16);
    offered_ = true;
    uint8_t bytes[28];
    memcpy(bytes, session_, 24);
    memcpy(bytes + 24, f.data + 8, 4);
    if (!send(start, bytes, sizeof(bytes))) {
      reset();
      enabled_ = true;
    }
    return;
  }
  if (!offered_ || f.size < 24 || memcmp(session_, f.data, 24))
    return;
  if (f.kind == ready && f.size == 30 && !active_ && uint32_t(now - probe_at_) < 1000 && utc &&
      f.data[28] == sensors_ && f.data[29] == display_) {
    anchor_tick_ = get32(f.data + 24);
    anchor_utc_ = utc;
    anchor_mono_ = heard_ = now;
    uncertainty_ = uint32_t(now - probe_at_) + 10;
    sent_at_ = now - 1000;
    acknowledged_ = heartbeat_sequence_ = sequence_ = sample_sequence_ = 0;
    active_ = true;
    state_(context_, true);
    return;
  }
  if (!active_)
    return;
  if (f.kind == heartbeat && f.size == 32 && get32(f.data + 24) == heartbeat_sequence_ &&
      get32(f.data + 24) > acknowledged_ &&
      uint32_t(get32(f.data + 28) - anchor_tick_) <= uint32_t(now - anchor_mono_) + uncertainty_) {
    acknowledged_ = get32(f.data + 24);
    heard_ = now;
    return;
  }
  if (f.kind == sample && f.size == 38) {
    const uint32_t seq = get32(f.data + 24), delta = uint32_t(get32(f.data + 28) - anchor_tick_);
    const int64_t at = anchor_utc_ - uncertainty_ + delta;
    if (!seq || seq <= sample_sequence_ || delta > uint32_t(now - anchor_mono_) + uncertainty_ ||
        at > utc || utc - at >= 60000)
      return;
    sample_sequence_ = seq;
    heard_ = now;
    LocalSample s;
    s.sequence = seq;
    s.sampled_at = at;
    s.temperature = Sensor(Metric(f.data[32]), int16_t(get16(f.data + 33)));
    s.humidity = Sensor(Metric(f.data[35]), int16_t(get16(f.data + 36)));
    sample_(context_, s);
    return;
  }
  if (f.kind == result && f.size == 33 && pending_ && get32(f.data + 24) == sequence_ &&
      f.data[32] <= unknown) {
    if (uint32_t(get32(f.data + 28) - anchor_tick_) > uint32_t(now - anchor_mono_) + uncertainty_)
      return;
    heard_ = now;
    pending_ = false;
    result_(context_, utc >= expires_ ? unknown : Status(f.data[32]), utc);
  }
}
bool Gateway::command(bool display, const char* text, int64_t expires) {
  const int64_t utc = utc_(context_);
  const size_t length = text ? strlen(text) : 0;
  if (!active_ || pending_ || sequence_ == UINT32_MAX || expires - utc <= uncertainty_ ||
      expires - utc > 15000 || (display && (!length || length > display_)) || length > 32 ||
      (!display && length))
    return false;
  for (size_t i = 0; i < length; ++i)
    if (text[i] < 32 || text[i] > 126)
      return false;
  const int64_t drift = utc - (anchor_utc_ + uint32_t(tick_(context_) - anchor_mono_));
  if (!utc || drift < -1000 || drift > 1000) {
    reset();
    return false;
  }
  Frame f;
  f.kind = openhuli_serial::command;
  f.size = uint8_t(34 + length);
  memcpy(f.data, session_, 24);
  put32(f.data + 24, ++sequence_);
  put32(f.data + 28, anchor_tick_ + uint32_t(expires - anchor_utc_ - uncertainty_));
  f.data[32] = display;
  f.data[33] = uint8_t(length);
  if (length)
    memcpy(f.data + 34, text, length);
  pending_ = true;
  expires_ = expires;
  if (!send_(context_, f)) {
    pending_ = false;
    return false;
  }
  return true;
}
} // namespace openhuli_serial
