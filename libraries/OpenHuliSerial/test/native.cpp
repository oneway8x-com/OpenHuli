#include "OpenHuliGateway.h"
#include "OpenHuliNode.h"
#include <cassert>
#include <deque>
#include <iostream>
#include <vector>
using namespace openhuli_serial;
static uint32_t tick = 100;
static unsigned effects = 0, receipts = 0, samples = 0;
static std::deque<uint8_t> to_node, to_gateway;
static std::vector<uint8_t> store(16, 255);
static int fail_after = -1;
static uint8_t read_store(void*, uint16_t i) { return store[i]; }
static void write_store(void*, uint16_t i, uint8_t v) {
  if (fail_after == 0)
    return;
  if (fail_after > 0)
    --fail_after;
  store[i] = v;
}
static uint32_t clock_tick(void*) { return tick; }
static int64_t utc(void*) { return 1767225600000LL + tick; }
static bool enqueue(std::deque<uint8_t>& q, const Frame& f) {
  uint8_t bytes[max_frame];
  const size_t n = encode(f, bytes);
  for (size_t i = 0; i < n; ++i)
    q.push_back(bytes[i]);
  return n > 0;
}
static bool node_send(void*, const Frame& f) { return enqueue(to_gateway, f); }
static bool gateway_send(void*, const Frame& f) { return enqueue(to_node, f); }
static Status display(void*, const char*) {
  ++effects;
  return succeeded;
}
static void sampled(void*, const LocalSample& s) {
  ++samples;
  assert(s.temperature.centi == -1234 && s.sampled_at <= utc(nullptr));
}
static void result_received(void*, Status s, int64_t) {
  ++receipts;
  assert(s == succeeded || s == unknown);
}
static void state(void*, bool) {}
int main() {
  static_assert(sizeof(Node) <= 512, "AVR node state budget exceeded");
  const uint32_t boot = next_boot(read_store, write_store, nullptr);
  assert(boot == 1);
  const auto committed = store;
  for (int cut = 0; cut < 9; ++cut) {
    store = committed;
    fail_after = cut;
    const uint32_t attempted = next_boot(read_store, write_store, nullptr);
    fail_after = -1;
    const uint32_t recovered = next_boot(read_store, write_store, nullptr);
    assert(recovered > boot && (!attempted || recovered > attempted));
  }
  store = committed;
  fail_after = -1;
  Node node(boot, 3, 32, node_send, clock_tick, nullptr, display);
  Gateway gateway(gateway_send, clock_tick, utc, nullptr, 3, 32, sampled, result_received, state);
  auto pump = [&]() {
    for (unsigned loops = 0; loops < 10 && (!to_node.empty() || !to_gateway.empty()); ++loops) {
      while (!to_node.empty()) {
        auto b = to_node.front();
        to_node.pop_front();
        node.feed(b);
      }
      while (!to_gateway.empty()) {
        auto b = to_gateway.front();
        to_gateway.pop_front();
        gateway.feed(b);
      }
    }
  };
  uint8_t nonce[16]{1};
  gateway.begin(nonce);
  gateway.poll();
  pump();
  assert(node.connected() && gateway.connected());
  assert(node.publish(Sensor(measured, -1234), Sensor(read_failed)));
  pump();
  assert(samples == 1);
  assert(!node.publish(Sensor(measured, 12600), Sensor()));
  assert(gateway.command(true, "Hello", utc(nullptr) + 1000));
  const auto original = to_node;
  pump();
  assert(effects == 1 && receipts == 1);
  to_node = original;
  pump();
  assert(effects == 1); // Exact duplicate cannot repeat the effect.
  assert(!gateway.command(true, "Hello", utc(nullptr) + 5));
  tick += 4000;
  node.poll();
  gateway.poll();
  pump();
  assert(receipts >= 1);
  // Replayed bytes cannot cross a fresh challenge/session.
  to_node = original;
  pump();
  assert(effects == 1);
  // AVR deadlines remain bounded across millis() wrap; a reboot cannot accept old frames.
  to_gateway.clear();
  to_node.clear();
  tick = UINT32_MAX - 20;
  Node wrapping(2, 0, 32, node_send, clock_tick, nullptr, display);
  auto feed_frame = [&](Node& target, const Frame& frame) {
    uint8_t b[max_frame];
    const auto n = encode(frame, b);
    for (size_t i = 0; i < n; ++i)
      target.feed(b[i]);
  };
  Frame probe_frame;
  probe_frame.kind = probe;
  feed_frame(wrapping, probe_frame);
  Decoder challenge_decoder;
  Frame offered;
  while (!to_gateway.empty()) {
    const auto b = to_gateway.front();
    to_gateway.pop_front();
    if (challenge_decoder.feed(b))
      offered = challenge_decoder.frame();
  }
  Frame start_frame;
  start_frame.kind = start;
  start_frame.size = 28;
  memcpy(start_frame.data, offered.data, 8);
  start_frame.data[8] = 1;
  memcpy(start_frame.data + 24, offered.data + 8, 4);
  feed_frame(wrapping, start_frame);
  assert(wrapping.connected());
  to_gateway.clear();
  Frame effect;
  effect.kind = command;
  effect.size = 35;
  memcpy(effect.data, start_frame.data, 24);
  put32(effect.data + 24, 1);
  put32(effect.data + 28, 20);
  effect.data[32] = 1;
  effect.data[33] = 1;
  effect.data[34] = 'X';
  const auto before = effects;
  tick = UINT32_MAX - 10;
  feed_frame(wrapping, effect);
  assert(effects == before + 1);
  tick = 30;
  put32(effect.data + 24, 2);
  feed_frame(wrapping, effect);
  assert(effects == before + 1);
  Node rebooted(3, 0, 32, node_send, clock_tick, nullptr, display);
  feed_frame(rebooted, start_frame);
  feed_frame(rebooted, effect);
  assert(!rebooted.connected() && effects == before + 1);
  Decoder decoder;
  Frame f;
  f.kind = probe;
  uint8_t bytes[max_frame];
  const auto n = encode(f, bytes);
  std::cout << "FRAME ";
  for (size_t i = 0; i < n; ++i) {
    static const char* h = "0123456789abcdef";
    std::cout << h[bytes[i] >> 4] << h[bytes[i] & 15];
  }
  std::cout << '\n';
  for (size_t i = 0; i < n; ++i)
    assert(decoder.feed(bytes[i]) == (i == n - 1));
  bytes[n - 1] ^= 1;
  for (size_t i = 0; i < n; ++i)
    assert(!decoder.feed(bytes[i]));
  std::cout << "PASS framing, node/gateway exchange, duplicate/reset fencing, EEPROM interruption "
               "and memory budget\n";
}
