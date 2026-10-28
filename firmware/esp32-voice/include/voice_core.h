#pragma once
#include <OpenHuliProtocol.h>
#include <array>
#include <cstddef>
#include <cstdint>

namespace openhuli {
constexpr size_t samples_per_chunk = 320;
constexpr size_t pcm_bytes = 640;
constexpr size_t frame_bytes = 664;
constexpr size_t max_control_bytes =
    15 * 1024; // Pinned WebSockets transport's bounded limit, stricter than wire v1.
constexpr uint32_t max_chunks = 1500;
constexpr uint32_t max_turns =
    64; // Reconnect before the v1 256-turn maximum; no unbounded ID history.
enum class State { offline, negotiating, ready, recording, draining, waiting, fault };
enum class Control { session, start, commit, cancel };
using device::valid_id;
bool write_control(char* out, size_t capacity, Control kind, const char* message_id,
                   const char* reference, uint32_t turn = 0, uint32_t stream = 0,
                   uint32_t sequence = 0);
void encode_frame(uint8_t* out, uint32_t stream, uint32_t turn, uint32_t sequence,
                  const uint8_t* pcm);
int16_t pcm_sample(int32_t raw, unsigned shift);
void convert_pcm(const int32_t* input, size_t count, unsigned shift, uint8_t* out);

class VoiceCore {
public:
  State state = State::offline;
  uint32_t turn = 0;
  uint32_t sent = 0;
  void connected();
  bool ready();
  bool start();
  bool release();
  bool frame_sent();
  bool commit();
  bool response();
  bool completed();
  bool cancel();
  void disconnected();
  void fail();

private:
  bool responded_ = false;
};

enum class FragmentResult { incomplete, complete, rejected };
class ControlBuffer {
public:
  FragmentResult push(const uint8_t* data, size_t length, bool start, bool final);
  void clear();
  char* data() { return bytes_.data(); }
  size_t size() const { return used_; }

private:
  std::array<char, max_control_bytes + 1> bytes_{};
  size_t used_ = 0;
  bool active_ = false;
};
// Small fixed session history. Hash collisions fail closed. All accepted controls count toward this
// cap.
class MessageHistory {
public:
  bool accept(const char* id);
  void clear() { count_ = 0; }

private:
  std::array<uint64_t, 256> hashes_{};
  size_t count_ = 0;
};
class Button {
public:
  void initialize(bool down, uint32_t now);
  bool update(bool down, uint32_t now); // True only on a debounced edge (30ms).
  bool down() const { return stable_; }

private:
  bool stable_ = false, candidate_ = false;
  uint32_t changed_ = 0;
};
} // namespace openhuli
