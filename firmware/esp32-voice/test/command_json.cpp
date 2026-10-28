#include "command_json.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
using namespace openhuli::weather;
static const std::string ping =
    R"({"version":1,"messageId":"msg","type":"device.command","deviceId":"device-1","commandId":"command-1","executionId":"execution-1","issuedAt":"2026-01-01T00:00:00.000Z","expiresAt":"2026-01-01T00:00:15.000Z","action":{"kind":"ping"}})";
static bool parse(std::string json, Command& command) {
  command = {};
  return parse_command(json.data(), json.size(), "device-1", command);
}
static std::string replace(std::string text, const std::string& from, const std::string& to) {
  const size_t at = text.find(from);
  assert(at != std::string::npos);
  text.replace(at, from.size(), to);
  return text;
}
int main() {
  Command c;
  assert(parse(ping, c) && c.action == Action::ping && !std::strcmp(c.command_id, "command-1"));
  assert(!parse(replace(ping, "device-1", "device-2"), c));
  assert(!parse(replace(ping, "\"version\":1", "\"version\":true"), c));
  assert(!parse(replace(ping, "\"version\":1", "\"version\":2"), c));
  assert(!parse(replace(ping, "\"messageId\":\"msg\"", "\"messageId\":9"), c));
  assert(!parse(replace(ping, "msg", "a\\u0000hidden"), c));
  assert(!parse(replace(ping, "command-1", std::string(65, 'a')), c));
  assert(!parse(replace(ping, "00:15.000Z", "00:60.000Z"), c));
  assert(!parse(replace(ping, "\"kind\":\"ping\"", "\"kind\":\"ping\",\"extra\":true"), c));
  assert(!parse(replace(ping, "\"action\":", "\"unexpected\":true,\"action\":"), c));
  assert(!parse(ping.substr(0, ping.size() - 1), c));
  assert(!parse(std::string(command_bytes + 1, 'a'), c));
  assert(!parse(ping + std::string(1, '\0'), c));
  auto display =
      replace(ping, "{\"kind\":\"ping\"}", "{\"kind\":\"display.write\",\"text\":\"Hello\"}");
  assert(parse(display, c) && c.action == Action::display && c.text_supported &&
         !std::strcmp(c.text, "Hello"));
  assert(!parse(replace(display, "Hello", ""), c));
  assert(!parse(replace(display, "Hello", "a\\u0000hidden"), c));
  assert(parse(replace(display, "Hello", std::string(129, 'a')), c) && !c.text_supported);
  assert(parse(replace(display, "Hello", "caf\\u00e9"), c) && !c.text_supported);
  assert(parse(replace(display, "Hello", "line\\nnext"), c) && !c.text_supported);
  Receiver receiver;
  receiver.connected(c.issued_at);
  assert(receiver.receive(c, c.issued_at, true).outcome == Outcome::unsupported);
  std::cout
      << "PASS real command JSON boundary, target/type/size/NUL rejection and unsupported text\n";
}
