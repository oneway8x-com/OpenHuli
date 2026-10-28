#include "OpenHuliWire.h"
namespace openhuli_serial {
size_t encode(const Frame& f, uint8_t* out) {
  if (!out || f.size > max_payload || f.kind < probe || f.kind > result)
    return 0;
  out[0] = 'O';
  out[1] = 'H';
  out[2] = 1;
  out[3] = f.kind;
  out[4] = f.size;
  memcpy(out + 5, f.data, f.size);
  uint16_t crc = 0xffff;
  for (size_t i = 2; i < size_t(5 + f.size); ++i)
    crc = crc_byte(crc, out[i]);
  put16(out + 5 + f.size, crc);
  return 7 + f.size;
}
bool Decoder::feed(uint8_t b) {
  switch (state_) {
  case 0:
    if (b == 'O')
      state_ = 1;
    break;
  case 1:
    state_ = b == 'H' ? 2 : b == 'O' ? 1 : 0;
    break;
  case 2:
    if (b != 1) {
      reset();
      break;
    }
    crc_ = crc_byte(0xffff, b);
    state_ = 3;
    break;
  case 3:
    if (b < probe || b > result) {
      reset();
      break;
    }
    frame_.kind = b;
    crc_ = crc_byte(crc_, b);
    state_ = 4;
    break;
  case 4:
    if (b > max_payload) {
      reset();
      break;
    }
    frame_.size = b;
    used_ = 0;
    crc_ = crc_byte(crc_, b);
    state_ = b ? 5 : 6;
    break;
  case 5:
    frame_.data[used_++] = b;
    crc_ = crc_byte(crc_, b);
    if (used_ == frame_.size)
      state_ = 6;
    break;
  case 6:
    low_ = b;
    state_ = 7;
    break;
  case 7: {
    const bool valid = crc_ == (uint16_t(low_) | uint16_t(b) << 8);
    reset();
    return valid;
  }
  default:
    reset();
  }
  return false;
}
namespace {
uint32_t slot(ReadByte read, void* c, uint16_t base) {
  uint8_t bytes[8];
  for (uint8_t i = 0; i < 8; ++i)
    bytes[i] = read(c, base + i);
  uint16_t crc = 0xffff;
  for (uint8_t i = 0; i < 4; ++i)
    crc = crc_byte(crc, bytes[i]);
  const uint32_t n = get32(bytes);
  return bytes[6] == 0xa5 && bytes[7] == 0x5a && get16(bytes + 4) == crc && n && n != UINT32_MAX
             ? n
             : 0;
}
} // namespace
uint32_t next_boot(ReadByte read, WriteByte write, void* c) {
  const uint32_t a = slot(read, c, 0), b = slot(read, c, 8), last = a > b ? a : b;
  if (!last)
    for (uint8_t i = 0; i < 16; ++i)
      if (read(c, i) != 0xff)
        return 0;
  if (last >= UINT32_MAX - 1)
    return 0;
  const uint32_t n = last + 1;
  const uint16_t base = a > b ? 8 : 0;
  uint8_t bytes[8];
  put32(bytes, n);
  uint16_t crc = 0xffff;
  for (uint8_t i = 0; i < 4; ++i)
    crc = crc_byte(crc, bytes[i]);
  put16(bytes + 4, crc);
  bytes[6] = 0xa5;
  bytes[7] = 0x5a;
  write(c, base + 7, 0);
  for (uint8_t i = 0; i < 7; ++i)
    write(c, base + i, bytes[i]);
  write(c, base + 7, bytes[7]);
  return slot(read, c, base) == n ? n : 0;
}
} // namespace openhuli_serial
