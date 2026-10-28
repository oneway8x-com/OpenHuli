#include "config.example.h"
#include "weather_core.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <vector>
using namespace openhuli::weather;
static unsigned writes = 0;
static bool persist_ok = true;
static int64_t saved_until = 0;
static bool persist(int64_t until) {
  if (persist_ok)
    saved_until = until;
  return persist_ok;
}
static int64_t current = 0;
static int64_t clock_now() { return current; }
static Outcome show(const char*) {
  ++writes;
  current += 5;
  return Outcome::succeeded;
}
static Outcome uncertain(const char*) {
  ++writes;
  return Outcome::unknown;
}
static Command command(const char* id = "command-1") {
  Command c;
  std::strcpy(c.message_id, "message-1");
  std::strcpy(c.command_id, id);
  std::strcpy(c.execution_id, "execution-1");
  c.issued_at = 1767225600000LL;
  c.expires_at = c.issued_at + 15000;
  c.action = Action::display;
  std::strcpy(c.text, "Hello sensor");
  return c;
}
int main() {
  assert(!config::weather_enabled && config::dht_data == -1 && !config::display_enabled &&
         !config::display_confirmed);
  assert(config::lcd_rs == -1 && config::lcd_enable == -1 && config::lcd_d4 == -1 &&
         config::lcd_d5 == -1 && config::lcd_d6 == -1 && config::lcd_d7 == -1);
  assert(!*config::device_mqtt_token && !*config::mqtt_root_ca);
  const uint8_t data[] = {55, 2, 23, 4, 84};
  std::vector<Pulse> pulses = {{false, 10}, {true, 30}, {false, 80}, {true, 80}};
  for (uint8_t byte : data)
    for (int bit = 7; bit >= 0; --bit) {
      pulses.push_back({false, 50});
      pulses.push_back({true, uint16_t(byte & (1 << bit) ? 70 : 27)});
    }
  auto reading = decode_dht11(pulses.data(), pulses.size());
  assert(reading.valid && reading.temperature > 23.39f && reading.temperature < 23.41f &&
         reading.humidity > 55.19f && reading.humidity < 55.21f);
  pulses.back().micros = 70;
  assert(!decode_dht11(pulses.data(), pulses.size()).valid);
  pulses.back().micros = 27;
  pulses[10].micros = 150;
  assert(!decode_dht11(pulses.data(), pulses.size()).valid);
  assert(!decode_dht11(nullptr, 0).valid);
  assert(!decode_dht11(pulses.data(), 40).valid);
  ClockGuard anchored;
  assert(!anchored.observe(0, 0));
  assert(anchored.observe(1767225600000LL, 100));
  assert(anchored.observe(1767225600100LL, 200));
  assert(anchored.now(300) == 1767225600200LL);
  assert(!anchored.observe(1767225600050LL, 300)); // A backwards step latches closed.
  assert(!anchored.observe(1767225601000LL, 1100) && anchored.now(1100) == 0);
  ClockGuard reset_clock;
  assert(reset_clock.observe(1767225600000LL, 0));
  assert(!reset_clock.observe(0, 100) && reset_clock.now(100) == 0);
  ClockGuard drift;
  assert(drift.observe(1767225600000LL, 0));
  assert(!drift.observe(1767225605000LL, 100));
  int64_t now = 0;
  char at[25];
  assert(parse_utc("2026-01-01T00:00:00.000Z", now) && now == 1767225600000LL);
  assert(format_utc(now, at, sizeof(at)) && !std::strcmp(at, "2026-01-01T00:00:00.000Z"));
  assert(parse_utc("2028-02-29T23:59:59.999Z", now));
  assert(!parse_utc("2027-02-29T00:00:00.000Z", now));
  assert(!parse_utc("2026-01-01T00:00:00.000Zjunk", now));
  assert(!parse_utc("2026-01-01T00:00:60.000Z", now));
  assert(!format_utc(0, at, sizeof(at)));
  Packet packet;
  const std::string json = "{\"command\":true}";
  for (size_t split = 0; split <= json.size(); ++split) {
    assert(packet.append(json.data(), split, 0, json.size(), false));
    assert(packet.append(json.data() + split, json.size() - split, split, json.size(), false));
    assert(packet.complete() && packet.size() == json.size() &&
           !std::strcmp(packet.data(), json.c_str()));
    packet.clear();
  }
  assert(!packet.append(json.data(), json.size(), 0, json.size(), true));
  assert(!packet.append(json.data(), 1, 1, json.size(), false));
  assert(!packet.append(json.data(), 1, 0, command_bytes + 1, false));
  assert(packet.append(json.data(), 1, 0, json.size(), false));
  assert(!packet.append(json.data(), 1, 2, json.size(), false));
  auto c = command();
  current = c.issued_at;
  Receiver receiver;
  receiver.connected(current);
  auto result = receiver.receive(c, current, true, show, 32, clock_now);
  assert(result.outcome == Outcome::succeeded && result.completed_at == current && writes == 1);
  assert(receiver.receive(c, current, true, show, 32, clock_now).completed_at ==
             result.completed_at &&
         writes == 1);
  auto conflict = c;
  std::strcpy(conflict.execution_id, "other-execution");
  assert(receiver.receive(conflict, current, true, show, 32).outcome == Outcome::conflict &&
         writes == 1);
  conflict = c;
  std::strcpy(conflict.text, "Different");
  assert(receiver.receive(conflict, current, true, show, 32).outcome == Outcome::conflict);
  assert(receiver.receive(c, current - 1, true, show, 32).outcome == Outcome::expired);
  assert(receiver.receive(c, current, false, show, 32).outcome == Outcome::expired);
  Receiver no_screen;
  no_screen.connected(c.issued_at);
  assert(no_screen.receive(c, current, true).outcome == Outcome::unsupported);
  c.action = Action::ping;
  assert(no_screen.receive(c, current, true).outcome == Outcome::succeeded);
  auto too_long = command("long-text");
  std::memset(too_long.text, 'a', 33);
  too_long.text[33] = '\0';
  assert(no_screen.receive(too_long, current, true, show, 32).outcome == Outcome::unsupported);
  auto unicode = command("unicode");
  unicode.text_supported = false;
  assert(no_screen.receive(unicode, current, true, show, 32).outcome == Outcome::unsupported);
  auto future = command("future");
  future.issued_at += 100;
  future.expires_at += 100;
  assert(no_screen.receive(future, current, true, show, 32).outcome == Outcome::expired);
  auto long_life = command("long-life");
  long_life.expires_at += 30000;
  assert(no_screen.receive(long_life, current, true, show, 32).outcome == Outcome::expired);
  auto expired = command("expired");
  assert(no_screen.receive(expired, expired.expires_at, true, show, 32).outcome ==
         Outcome::expired);
  Receiver boot;
  boot.connected(c.issued_at + 1000);
  assert(boot.receive(c, c.issued_at + 1000, true, show, 32).outcome ==
         Outcome::expired); // No replay after reboot.
  Receiver reconnect;
  reconnect.connected(c.issued_at);
  c.action = Action::display;
  assert(reconnect.receive(c, current, true, show, 32).outcome == Outcome::succeeded);
  reconnect.connected(current + 100);
  assert(reconnect.receive(c, current + 100, true, show, 32).outcome == Outcome::expired);
  Receiver bounded;
  bounded.connected(c.issued_at);
  for (unsigned i = 0; i < 16; ++i) {
    auto item = command(("bounded-" + std::to_string(i)).c_str());
    item.action = Action::ping;
    assert(bounded.receive(item, c.issued_at, true).outcome == Outcome::succeeded);
  }
  assert(bounded.receive(command("overflow"), c.issued_at, true, show, 32).outcome ==
         Outcome::full);
  auto fresh = command("after-expiry");
  fresh.issued_at += 16000;
  fresh.expires_at += 16000;
  assert(bounded.receive(fresh, fresh.issued_at, true, uncertain, 32).outcome == Outcome::unknown);
  Receiver deadline;
  c = command();
  deadline.connected(c.issued_at);
  current = c.expires_at - 1;
  assert(deadline.receive(c, current, true, show, 32, clock_now).outcome == Outcome::unknown);
  Receiver journaled;
  c = command();
  current = c.issued_at;
  journaled.connected(current);
  const unsigned prior_writes = writes;
  persist_ok = false;
  assert(journaled.receive(c, current, true, show, 32, clock_now, persist).outcome ==
             Outcome::failed &&
         writes == prior_writes);
  c = command("durable");
  persist_ok = true;
  assert(journaled.receive(c, current, true, show, 32, clock_now, persist).outcome ==
         Outcome::succeeded);
  assert(saved_until == c.expires_at && writes == prior_writes + 1);
  Receiver after_restart;
  after_restart.connected(current - 500, saved_until);
  assert(after_restart.receive(c, current, true, show, 32, clock_now, persist).outcome ==
         Outcome::expired);
  assert(writes ==
         prior_writes + 1); // Persisted expiry fences a replay even with a small clock offset.
  char output[1024];
  c = command();
  assert(write_manifest(output, sizeof(output), "device-1", "boot-1", true, 32));
  std::cout << "MANIFEST " << output << '\n';
  assert(write_manifest(output, sizeof(output), "device-1", "boot-1", false, 0));
  std::cout << "SENSOR_MANIFEST " << output << '\n';
  assert(write_manifest(output, sizeof(output), "device-1", "boot-1", true, 0));
  std::cout << "NO_DISPLAY_MANIFEST " << output << '\n';
  assert(write_presence(output, sizeof(output), "device-1", "boot-1", 2, true, c.issued_at));
  std::cout << "ONLINE " << output << '\n';
  assert(write_presence(output, sizeof(output), "device-1", "boot-1", 3, false, c.issued_at));
  std::cout << "WILL " << output << '\n';
  assert(write_presence(output, sizeof(output), "device-1", "boot-1", 4, true, c.issued_at));
  std::cout << "RECONNECTED " << output << '\n';
  assert(write_telemetry(output, sizeof(output), "device-1", "boot-1", 0, c.issued_at, reading));
  std::cout << "TELEMETRY " << output << '\n';
  assert(write_telemetry(output, sizeof(output), "device-1", "boot-1", 1, c.issued_at, {}));
  std::cout << "SENSOR_ERROR " << output << '\n';
  assert(!write_telemetry(output, sizeof(output), "device-1", "boot-1", 2, c.issued_at,
                          {true, std::numeric_limits<float>::quiet_NaN(), 50}));
  assert(!write_manifest(output, 10, "device-1", "boot-1", true));
  for (auto outcome : {Outcome::succeeded, Outcome::unsupported, Outcome::expired, Outcome::unknown,
                       Outcome::full, Outcome::failed}) {
    assert(write_result(output, sizeof(output), "device-1", c, {outcome, c.issued_at + 5}));
    std::cout << "RESULT " << output << '\n';
  }
  std::cout << "PASS weather pulse/state/wire tests\n";
}
