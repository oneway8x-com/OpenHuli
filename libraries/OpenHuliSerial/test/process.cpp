#include "OpenHuliNode.h"
#include <chrono>
#include <cstdio>
using namespace openhuli_serial;
static const auto began = std::chrono::steady_clock::now();
static uint32_t tick(void*) {
  return uint32_t(std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - began)
                      .count());
}
static bool send(void*, const Frame& f) {
  uint8_t bytes[max_frame];
  const auto n = encode(f, bytes);
  return std::fwrite(bytes, 1, n, stdout) == n && std::fflush(stdout) == 0;
}
int main() {
  Node node(1, 0, 0, send, tick, nullptr);
  int c;
  while ((c = std::getchar()) != EOF)
    node.feed(uint8_t(c));
}
