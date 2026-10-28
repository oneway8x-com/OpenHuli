#include <OpenHuli.h>
#include <cassert>
#include <iostream>
#include <limits>
using namespace openhuli;
using namespace openhuli::device;
int main() {
  constexpr int64_t now = 1767225600000LL;
  char out[1024];
  ClockGuard invalid_clock;
  assert(!invalid_clock.observe(4102444800000LL, 0) && invalid_clock.now(0) == 0);
  Capabilities caps;
  caps.humidity = false;
  Telemetry sample;
  sample.temperature = {SensorStatus::measured, -12.345f};
  assert(write_manifest(out, sizeof(out), "device-1", "boot-1", caps, "client-test-v1"));
  std::cout << "MANIFEST " << out << '\n';
  assert(write_telemetry(out, sizeof(out), "device-1", "boot-1", 0, now, sample));
  std::cout << "TEMPERATURE " << out << '\n';
  sample.temperature.status = SensorStatus::read_failed;
  assert(write_telemetry(out, sizeof(out), "device-1", "boot-1", 1, now, sample));
  std::cout << "FAILED " << out << '\n';
  sample.temperature.status = SensorStatus::unavailable;
  assert(write_telemetry(out, sizeof(out), "device-1", "boot-1", 2, now, sample));
  std::cout << "UNAVAILABLE " << out << '\n';
  assert(!write_telemetry(out, sizeof(out), "device-1", "boot-1", 0, now, Telemetry{}));
  for (float bad : {-40.1f, 125.1f, std::numeric_limits<float>::infinity(),
                    std::numeric_limits<float>::quiet_NaN()}) {
    sample.temperature = {SensorStatus::measured, bad};
    assert(!write_telemetry(out, sizeof(out), "device-1", "boot-1", 0, now, sample));
  }
  sample.temperature = {SensorStatus::measured, 125};
  sample.humidity = {SensorStatus::measured, 100};
  assert(write_telemetry(out, sizeof(out), "device-1", "boot-1", UINT32_MAX, now, sample));
  sample.humidity.value = 100.1f;
  assert(!write_telemetry(out, sizeof(out), "device-1", "boot-1", 0, now, sample));
  assert(!write_presence(nullptr, 0, "device-1", "boot-1", 0, true, now));
  assert(!write_manifest(out, 10, "device-1", "boot-1", caps, "test"));
  assert(!write_manifest(out, sizeof(out), "device-1", "boot-1", caps, "bad\"json"));
  caps.temperature = false;
  assert(write_manifest(out, sizeof(out), "device-1", "boot-1", caps, "test"));
  std::cout << "PING_MANIFEST " << out << '\n';
  ClientConfig c;
  assert(!valid_config(c));
  c.device_id = "device-1";
  c.mqtt_host = "mqtt.example.test";
  c.mqtt_username = "ohm1.synthetic";
  c.mqtt_client_id = "openhuli-device-synthetic";
  c.mqtt_token = "synthetic-token";
  c.root_ca = "-----BEGIN CERTIFICATE-----synthetic";
  assert(valid_config(c));
  c.mqtt_host = "mqtts://user:secret@host";
  assert(!valid_config(c));
  c.mqtt_host = "mqtt.example.test";
  c.mqtt_port = 0;
  assert(!valid_config(c));
  c.mqtt_port = 8883;
  c.root_ca = "";
  assert(!valid_config(c));
  c.root_ca = "-----BEGIN CERTIFICATE-----synthetic";
  c.mqtt_token = "bad\ntoken";
  assert(!valid_config(c));
  c.mqtt_token = "synthetic-token";
  c.capabilities.display_characters = 32;
  assert(!valid_config(c));
  std::cout << "PASS client config and optional sensor metrics/errors/ranges/bounds\n";
}
