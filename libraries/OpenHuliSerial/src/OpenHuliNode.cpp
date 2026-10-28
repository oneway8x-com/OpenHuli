#include "OpenHuliNode.h"
namespace openhuli_serial {
Node::Node(uint32_t boot, uint8_t sensors, uint8_t limit, Send send, Tick tick, void* context,
           Display display)
    : send_(send), tick_(tick), context_(context), display_(display), boot_(boot),
      sensors_(sensors), display_limit_(limit) {
  valid_ = boot && boot != UINT32_MAX && sensors <= 3 && limit <= 32 && (!limit || display) &&
           send && tick;
}
bool Node::emit(uint8_t kind, const uint8_t* bytes, uint8_t size) {
  Frame f;
  f.kind = kind;
  f.size = size;
  if (size)
    memcpy(f.data, bytes, size);
  return send_(context_, f);
}
void Node::poll() {
  if (armed_ && (uint32_t(tick_(context_) - heard_) >= 3000 ||
                 uint32_t(tick_(context_) - started_) >= 3600000))
    armed_ = offered_ = false;
}
void Node::feed(uint8_t b) {
  if (!valid_)
    return;
  poll();
  if (decoder_.feed(b))
    accept(decoder_.frame());
}
void Node::report() {
  uint8_t bytes[33];
  memcpy(bytes, session_, session_bytes);
  put32(bytes + 24, sequence_);
  put32(bytes + 28, completed_);
  bytes[32] = status_;
  emit(result, bytes, sizeof(bytes));
}
void Node::accept(const Frame& f) {
  const uint32_t now = tick_(context_);
  if (f.kind == probe && f.size == 0) {
    armed_ = offered_ = false;
    if (generation_ == UINT32_MAX)
      return;
    ++generation_;
    challenged_at_ = now;
    offered_ = true;
    uint8_t bytes[14];
    put32(bytes, boot_);
    put32(bytes + 4, generation_);
    put32(bytes + 8, now);
    bytes[12] = sensors_;
    bytes[13] = display_limit_;
    emit(challenge, bytes, sizeof(bytes));
    return;
  }
  if (f.kind == start && f.size == 28 && offered_ && !armed_ &&
      uint32_t(now - challenged_at_) < 1000 && get32(f.data) == boot_ &&
      get32(f.data + 4) == generation_ && get32(f.data + 24) == challenged_at_) {
    bool nonzero = false;
    for (uint8_t i = 8; i < 24; ++i)
      nonzero |= f.data[i] != 0;
    if (!nonzero)
      return;
    memcpy(session_, f.data, 24);
    armed_ = true;
    offered_ = false;
    heard_ = started_ = now;
    heartbeat_sequence_ = sequence_ = sample_sequence_ = 0;
    uint8_t bytes[30];
    memcpy(bytes, session_, 24);
    put32(bytes + 24, now);
    bytes[28] = sensors_;
    bytes[29] = display_limit_;
    if (!emit(ready, bytes, sizeof(bytes)))
      armed_ = false;
    return;
  }
  if (!armed_ || f.size < 24 || memcmp(session_, f.data, 24))
    return;
  if (f.kind == heartbeat && f.size == 28 && get32(f.data + 24) > heartbeat_sequence_) {
    heartbeat_sequence_ = get32(f.data + 24);
    heard_ = now;
    uint8_t bytes[32];
    memcpy(bytes, session_, 24);
    put32(bytes + 24, heartbeat_sequence_);
    put32(bytes + 28, now);
    emit(heartbeat, bytes, sizeof(bytes));
    return;
  }
  if (f.kind != command || f.size < 34)
    return;
  const uint32_t seq = get32(f.data + 24), deadline = get32(f.data + 28);
  const uint8_t action = f.data[32], length = f.data[33];
  if (!seq || f.size != 34 + length || length > 32 || action > 1 || (!action && length) ||
      (action && !length))
    return;
  for (uint8_t i = 0; i < length; ++i)
    if (f.data[34 + i] < 32 || f.data[34 + i] > 126)
      return;
  if (seq == sequence_) {
    if (last_.size == f.size && !memcmp(last_.data, f.data, f.size))
      report();
    return;
  }
  if (seq < sequence_ || sequence_ == UINT32_MAX)
    return;
  // Reserve exact identity before calling a driver. One synchronous effect at a time.
  sequence_ = seq;
  last_ = f;
  status_ = unknown;
  completed_ = now;
  if (!future(deadline, now) || uint32_t(deadline - now) > 15000)
    status_ = expired;
  else if (action && (!display_ || length > display_limit_))
    status_ = unsupported;
  else {
    char text[33];
    memcpy(text, f.data + 34, length);
    text[length] = 0;
    status_ = action ? display_(context_, text) : succeeded;
    if (status_ == expired || status_ > unknown)
      status_ = unknown;
    completed_ = tick_(context_);
    if (!future(deadline, completed_))
      status_ = unknown;
  }
  report();
}
bool Node::publish(Sensor t, Sensor h) {
  if (!valid_)
    return false;
  poll();
  if (!armed_ || sample_sequence_ == UINT32_MAX || (t.state == omitted && h.state == omitted) ||
      t.state > unavailable || h.state > unavailable || (!(sensors_ & 1) && t.state != omitted) ||
      (!(sensors_ & 2) && h.state != omitted) ||
      (t.state == measured && (t.centi < -4000 || t.centi > 12500)) ||
      (h.state == measured && (h.centi < 0 || h.centi > 10000)))
    return false;
  uint8_t bytes[38];
  memcpy(bytes, session_, 24);
  put32(bytes + 24, ++sample_sequence_);
  put32(bytes + 28, tick_(context_));
  bytes[32] = t.state;
  put16(bytes + 33, uint16_t(t.centi));
  bytes[35] = h.state;
  put16(bytes + 36, uint16_t(h.centi));
  return emit(sample, bytes, sizeof(bytes));
}
} // namespace openhuli_serial
