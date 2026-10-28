#pragma once
#include <cstdint>
#include <sys/select.h>
namespace fixture {
extern uint64_t tick;
extern int64_t wall_offset;
} // namespace fixture
inline int openhuli_fake_gettimeofday(timeval* out, void*) {
  const int64_t ms = 1767225600000LL + int64_t(fixture::tick) + fixture::wall_offset;
  out->tv_sec = long(ms / 1000);
  out->tv_usec = long(ms % 1000 * 1000);
  return 0;
}

#define gettimeofday openhuli_fake_gettimeofday
