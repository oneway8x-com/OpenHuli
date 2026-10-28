#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
namespace openhuli_serial {
const uint8_t max_payload = 80, max_frame = 87, session_bytes = 24;
enum Kind : uint8_t {
  probe = 1,
  challenge = 2,
  start = 3,
  ready = 4,
  heartbeat = 5,
  sample = 6,
  command = 7,
  result = 8
};
enum Status : uint8_t { succeeded = 0, failed = 1, expired = 2, unsupported = 3, unknown = 4 };
enum Metric : uint8_t { omitted = 0, measured = 1, read_failed = 2, unavailable = 3 };
struct Frame {
  uint8_t kind = 0, size = 0, data[max_payload]{};
};
inline uint16_t crc_byte(uint16_t crc, uint8_t value) {
  crc ^= uint16_t(value) << 8;
  for (uint8_t i = 0; i < 8; ++i)
    crc = crc & 0x8000 ? uint16_t((crc << 1) ^ 0x1021) : uint16_t(crc << 1);
  return crc;
}
inline uint32_t get32(const uint8_t* p) {
  return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
inline void put32(uint8_t* p, uint32_t v) {
  for (uint8_t i = 0; i < 4; ++i)
    p[i] = uint8_t(v >> (8 * i));
}
inline uint16_t get16(const uint8_t* p) { return uint16_t(p[0]) | uint16_t(p[1]) << 8; }
inline void put16(uint8_t* p, uint16_t v) {
  p[0] = uint8_t(v);
  p[1] = uint8_t(v >> 8);
}
inline bool future(uint32_t deadline, uint32_t now) { return int32_t(deadline - now) > 0; }
size_t encode(const Frame& frame, uint8_t* bytes);
class Decoder {
public:
  bool feed(uint8_t byte);
  const Frame& frame() const { return frame_; }
  void reset() {
    state_ = used_ = 0;
    crc_ = 0xffff;
  }

private:
  Frame frame_;
  uint16_t crc_ = 0xffff;
  uint8_t state_ = 0, used_ = 0, low_ = 0;
};
using ReadByte = uint8_t (*)(void*, uint16_t);
using WriteByte = void (*)(void*, uint16_t, uint8_t);
// Two committed CRC-protected slots, 16 bytes total. Zero means storage fault/exhaustion.
uint32_t next_boot(ReadByte read, WriteByte write, void* context);
} // namespace openhuli_serial
