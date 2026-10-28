#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
namespace openhuli::weather {
constexpr size_t command_bytes = 4096;
constexpr size_t display_limit = 128; // ASCII text only for the optional local adapter.
class ClockGuard {
public:
  bool observe(int64_t utc, uint64_t monotonic_ms);
  int64_t now(uint64_t monotonic_ms) const;

private:
  int64_t anchor_utc_ = 0, last_utc_ = 0;
  uint64_t anchor_ms_ = 0, last_ms_ = 0;
  bool failed_ = false;
};
struct Pulse {
  bool high;
  uint16_t micros;
};
struct Reading {
  bool valid = false;
  float temperature = 0, humidity = 0;
};
Reading decode_dht11(const Pulse* pulses, size_t count);
bool parse_utc(const char* text, int64_t& milliseconds);
bool format_utc(int64_t milliseconds, char* out, size_t capacity);
bool write_presence(char* out, size_t capacity, const char* device, const char* boot,
                    uint32_t sequence, bool online, int64_t now);
bool write_telemetry(char* out, size_t capacity, const char* device, const char* boot,
                     uint32_t sequence, int64_t sampled_at, Reading reading);
bool write_manifest(char* out, size_t capacity, const char* device, const char* boot,
                    bool microphone, size_t display_characters = 0);

// One active receive packet; MQTT offsets and total size must agree exactly.
class Packet {
public:
  bool append(const char* bytes, size_t length, size_t offset, size_t total, bool retained);
  void clear() {
    used_ = expected_ = 0;
    active_ = false;
  }
  bool complete() const { return active_ && used_ == expected_; }
  const char* data() const { return bytes_.data(); }
  size_t size() const { return used_; }

private:
  std::array<char, command_bytes + 1> bytes_{};
  size_t used_ = 0, expected_ = 0;
  bool active_ = false;
};
enum class Action { ping, display };
struct Command {
  char message_id[65]{}, command_id[65]{}, execution_id[65]{};
  int64_t issued_at = 0, expires_at = 0;
  Action action = Action::ping;
  char text[display_limit + 1]{};
  bool text_supported = true;
};
enum class Outcome { succeeded, failed, expired, unsupported, unknown, full, conflict };
struct Result {
  Outcome outcome = Outcome::unknown;
  int64_t completed_at = 0;
};
using DisplayWrite = Outcome (*)(const char* text);
using Clock = int64_t (*)();
using Reserve = bool (*)(int64_t expires_at);
class Receiver {
public:
  // Called after each fresh MQTT connection. Old work cannot re-enter after reboot/reconnect.
  void connected(int64_t now, int64_t previous_boot_until = 0) {
    floor_ = now > previous_boot_until ? now : previous_boot_until;
  }
  Result receive(const Command& command, int64_t now, bool clock_ready,
                 DisplayWrite display = nullptr, size_t maximum_text = 0, Clock clock = nullptr,
                 Reserve reserve = nullptr);

private:
  struct Entry {
    bool used = false;
    Command command{};
    Result result{};
  };
  std::array<Entry, 16> entries_{};
  int64_t floor_ = 0, last_clock_ = 0;
};
bool write_result(char* out, size_t capacity, const char* device, const Command& command,
                  Result result);
} // namespace openhuli::weather
