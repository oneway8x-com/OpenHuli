#include "voice_core.h"
#include <cstdio>
#include <cstring>
#include <limits>

namespace openhuli {
bool write_control(char* out, size_t capacity, Control kind, const char* id, const char* ref,
                   uint32_t turn, uint32_t stream, uint32_t sequence) {
  if (!out || !capacity || !valid_id(id) || !valid_id(ref))
    return false;
  int written = -1;
  switch (kind) {
  case Control::session:
    written = std::snprintf(out, capacity,
                            "{\"version\":1,\"messageId\":\"%s\",\"type\":\"session.start\","
                            "\"conversationId\":\"%s\",\"inputFormat\":{\"encoding\":\"pcm_s16le\","
                            "\"sampleRateHz\":16000,\"channels\":1,\"chunkDurationMs\":20}}",
                            id, ref);
    break;
  case Control::start:
    if (!turn || !stream)
      return false;
    written = std::snprintf(out, capacity,
                            "{\"version\":1,\"messageId\":\"%s\",\"type\":\"turn.start\","
                            "\"turnId\":\"%s\",\"turnSequence\":%lu,\"streamId\":%lu}",
                            id, ref, static_cast<unsigned long>(turn),
                            static_cast<unsigned long>(stream));
    break;
  case Control::commit:
    written = std::snprintf(out, capacity,
                            "{\"version\":1,\"messageId\":\"%s\",\"type\":\"turn.commit\","
                            "\"turnId\":\"%s\",\"lastSequence\":%lu}",
                            id, ref, static_cast<unsigned long>(sequence));
    break;
  case Control::cancel:
    written = std::snprintf(
        out, capacity,
        "{\"version\":1,\"messageId\":\"%s\",\"type\":\"turn.cancel\",\"turnId\":\"%s\"}", id, ref);
    break;
  }
  return written >= 0 && static_cast<size_t>(written) < capacity;
}
static void be32(uint8_t* out, uint32_t value) {
  out[0] = static_cast<uint8_t>(value >> 24);
  out[1] = static_cast<uint8_t>(value >> 16);
  out[2] = static_cast<uint8_t>(value >> 8);
  out[3] = static_cast<uint8_t>(value);
}
void encode_frame(uint8_t* out, uint32_t stream, uint32_t turn, uint32_t sequence,
                  const uint8_t* pcm) {
  out[0] = 'O';
  out[1] = 'H';
  out[2] = 1;
  out[3] = 1;
  be32(out + 4, stream);
  be32(out + 8, turn);
  be32(out + 12, sequence);
  be32(out + 16, pcm_bytes);
  be32(out + 20, 0);
  std::memcpy(out + 24, pcm, pcm_bytes);
}
int16_t pcm_sample(int32_t raw, unsigned shift) {
  if (shift > 31)
    return 0;
  const int64_t divisor = int64_t{1} << shift;
  // Floor division matches an arithmetic right shift without implementation-defined signed
  // shifting.
  int64_t value = raw >= 0 ? int64_t{raw} / divisor : -((-int64_t{raw} + divisor - 1) / divisor);
  if (value > 32767)
    value = 32767;
  if (value < -32768)
    value = -32768;
  return static_cast<int16_t>(value);
}
void convert_pcm(const int32_t* input, size_t count, unsigned shift, uint8_t* out) {
  for (size_t i = 0; i < samples_per_chunk; ++i) {
    const uint16_t sample = static_cast<uint16_t>(i < count ? pcm_sample(input[i], shift) : 0);
    out[i * 2] = static_cast<uint8_t>(sample);
    out[i * 2 + 1] = static_cast<uint8_t>(sample >> 8);
  }
}
void VoiceCore::connected() {
  state = State::negotiating;
  turn = sent = 0;
  responded_ = false;
}
bool VoiceCore::ready() {
  if (state != State::negotiating)
    return false;
  state = State::ready;
  return true;
}
bool VoiceCore::start() {
  if (state != State::ready || turn >= max_turns)
    return false;
  ++turn;
  sent = 0;
  responded_ = false;
  state = State::recording;
  return true;
}
bool VoiceCore::release() {
  if (state != State::recording)
    return false;
  state = State::draining;
  return true;
}
bool VoiceCore::frame_sent() {
  if ((state != State::recording && state != State::draining) || sent >= max_chunks)
    return false;
  ++sent;
  return true;
}
bool VoiceCore::commit() {
  if (state != State::draining || !sent)
    return false;
  state = State::waiting;
  return true;
}
bool VoiceCore::response() {
  if (state != State::waiting || responded_)
    return false;
  responded_ = true;
  return true;
}
bool VoiceCore::completed() {
  if (state != State::waiting || !responded_)
    return false;
  state = State::ready;
  return true;
}
bool VoiceCore::cancel() {
  if (state != State::recording && state != State::draining && state != State::waiting)
    return false;
  state = State::ready;
  return true;
}
void VoiceCore::disconnected() {
  state = State::offline;
  sent = 0;
  responded_ = false;
}
void VoiceCore::fail() { state = State::fault; }
FragmentResult ControlBuffer::push(const uint8_t* data, size_t length, bool start, bool final) {
  if ((start && active_) || (!start && !active_)) {
    clear();
    return FragmentResult::rejected;
  }
  if (start) {
    used_ = 0;
    active_ = true;
  }
  if (length > max_control_bytes - used_) {
    clear();
    return FragmentResult::rejected;
  }
  if (length)
    std::memcpy(bytes_.data() + used_, data, length);
  used_ += length;
  bytes_[used_] = '\0';
  if (!final)
    return FragmentResult::incomplete;
  active_ = false;
  return FragmentResult::complete;
}
void ControlBuffer::clear() {
  used_ = 0;
  active_ = false;
  bytes_[0] = '\0';
}
bool MessageHistory::accept(const char* id) {
  if (!valid_id(id) || count_ == hashes_.size())
    return false;
  uint64_t hash = 14695981039346656037ULL;
  for (const char* c = id; *c; ++c) {
    hash ^= static_cast<uint8_t>(*c);
    hash *= 1099511628211ULL;
  }
  for (size_t i = 0; i < count_; ++i)
    if (hashes_[i] == hash)
      return false;
  hashes_[count_++] = hash;
  return true;
}
void Button::initialize(bool down, uint32_t now) {
  stable_ = candidate_ = down;
  changed_ = now;
}
bool Button::update(bool down, uint32_t now) {
  if (down != candidate_) {
    candidate_ = down;
    changed_ = now;
  }
  if (candidate_ != stable_ && uint32_t(now - changed_) >= 30) {
    stable_ = candidate_;
    return true;
  }
  return false;
}
} // namespace openhuli
