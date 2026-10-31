#include "../weather_station_online/station_huli.h"
#include <cassert>
#include <iostream>
#include <limits>
#include <string>

struct Client {
  bool online = true, accepted = true;
  unsigned calls = 0;
  int64_t utc = 1792926000000LL, captured = 0;
  openhuli::device::Reading reading;
  bool connected() const { return online; }
  int64_t now() const { return utc; }
  bool publish(openhuli::device::Reading value, int64_t at) {
    ++calls;
    reading = value;
    captured = at;
    return accepted;
  }
};

int main() {
  Client client;
  station::Publisher publisher;
  assert(publisher.sample(client, 2000, 23.4f, 55.2f));
  assert(client.calls == 1 && client.reading.valid && client.captured == client.utc);
  char packet[1024];
  using namespace openhuli::device;
  assert(write_manifest(packet, sizeof(packet), "station-test", "boot-test", false, 32));
  std::cout << "MANIFEST " << packet << '\n';
  assert(write_telemetry(packet, sizeof(packet), "station-test", "boot-test", 0, client.captured,
                         client.reading));
  std::cout << "TELEMETRY " << packet << '\n';
  assert(!publisher.sample(client, 31999, 99, 99));
  assert(client.calls == 1);
  client.utc += 30000;
  assert(publisher.sample(client, 32000, NAN, 50));
  assert(!client.reading.valid);
  assert(write_telemetry(packet, sizeof(packet), "station-test", "boot-test", 1, client.captured,
                         client.reading));
  std::cout << "SENSOR_ERROR " << packet << '\n';
  client.online = false;
  assert(!publisher.sample(client, 62000, 10, 30));
  assert(client.calls == 2);
  client.online = true;
  client.utc += 60000;
  assert(publisher.sample(client, 92000, 24, 60));
  assert(client.calls == 3 && client.reading.temperature == 24); // No offline sample replay.
  client.utc = 0;
  assert(!publisher.sample(client, 122000, 25, 70));
  assert(client.calls == 3); // No fabricated timestamp before time synchronization.
  client.utc = 1792926120000LL;
  client.accepted = false;
  assert(!publisher.sample(client, 152000, 25, 70));
  client.accepted = true;
  assert(!publisher.sample(client, 152001, 25, 70)); // No immediate uncertain-send retry.
  station::Publisher wrap;
  assert(wrap.sample(client, UINT32_MAX - 1000, 20, 50));
  assert(!wrap.sample(client, 28998, 20, 50));
  assert(wrap.sample(client, 28999, 20, 50));
  for (const auto reading : {station::roomReading(INFINITY, 50), station::roomReading(81, 50),
                             station::roomReading(-41, 50), station::roomReading(20, 101),
                             station::roomReading(20, -1), station::roomReading(20, NAN)})
    assert(!reading.valid && reading.temperature == 0 && reading.humidity == 0);
  assert(station::roomReading(-40, 0).valid && station::roomReading(80, 100).valid);

  station::DisplayMessage message;
  assert(!message.active(0));
  assert(!message.set(nullptr, 0) && !message.set("", 0));
  assert(!message.set("line\nbreak", 0) && !message.set("\xc3\xa4", 0));
  assert(!message.set("012345678901234567890123456789012", 0));
  assert(message.set("0123456789abcdefsecond row", UINT32_MAX - 1000));
  assert(std::string(message.screen().rows[0]) == "0123456789abcdef");
  assert(std::string(message.screen().rows[1]) == "second row      ");
  assert(message.active(13998) && !message.active(13999));
  assert(message.set("short", 20000));
  assert(std::string(message.screen().rows[0]) == "short           ");
  assert(std::string(message.screen().rows[1]) == "                ");
  assert(message.active(34999) && !message.active(35000));
  assert(!message.set("bad\ttext", 30000));
  assert(!message.active(35000)); // Invalid text does not extend the prior message.
  std::cout << "PASS station indoor telemetry, failures, cadence and display hold\n";
}
