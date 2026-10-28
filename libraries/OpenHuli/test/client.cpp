#include "transport.h"
#include <OpenHuli.h>
#include <cassert>
#include <iostream>
using namespace openhuli;
using namespace openhuli::device;
namespace fixture {
uint64_t tick = 0;
int64_t wall_offset = 0;
bool network = false, auto_connect = true, auto_ack = true, fail_publish = false,
     fail_start = false, fail_reserve = false;
FakeMqtt* active = nullptr;
esp_mqtt_client_config_t config;
std::string will;
std::vector<Publication> publications;
void event(int id) {
  esp_mqtt_event_t e;
  e.msg_id = 7;
  active->callback(active->context, nullptr, id, &e);
}
void command(std::string text, bool retained, const char* topic) {
  esp_mqtt_event_t e;
  e.data = &text[0];
  e.topic = const_cast<char*>(topic);
  e.data_len = e.total_data_len = int(text.size());
  e.topic_len = int(std::strlen(topic));
  e.retain = retained;
  active->callback(active->context, nullptr, MQTT_EVENT_DATA, &e);
}
} // namespace fixture
FakeWifi WiFi;
FakeMqtt* esp_mqtt_client_init(const esp_mqtt_client_config_t* config) {
  fixture::config = *config;
  fixture::will = config->lwt_msg;
  return fixture::active = new FakeMqtt;
}
int esp_mqtt_client_register_event(FakeMqtt* c, int, Handler callback, void* context) {
  c->callback = callback;
  c->context = context;
  return ESP_OK;
}
int esp_mqtt_client_start(FakeMqtt*) {
  if (fixture::fail_start)
    return ESP_FAIL;
  if (fixture::auto_connect)
    fixture::event(MQTT_EVENT_CONNECTED);
  return ESP_OK;
}
int esp_mqtt_client_stop(FakeMqtt*) { return ESP_OK; }
int esp_mqtt_client_destroy(FakeMqtt* c) {
  delete c;
  fixture::active = nullptr;
  return ESP_OK;
}
int esp_mqtt_client_disconnect(FakeMqtt*) {
  fixture::event(MQTT_EVENT_DISCONNECTED);
  return ESP_OK;
}
int esp_mqtt_client_publish(FakeMqtt*, const char* topic, const char* data, int, int qos,
                            int retain) {
  if (fixture::fail_publish)
    return -1;
  fixture::publications.push_back({topic, data, bool(retain), qos});
  return 0;
}
int esp_mqtt_client_subscribe(FakeMqtt*, const char*, int) {
  if (fixture::auto_ack)
    fixture::event(MQTT_EVENT_SUBSCRIBED);
  return 7;
}
static bool disconnect_on_reserve = false;
static unsigned effects = 0;
static int64_t reserved_until = 0;
static bool reserve(int64_t until) {
  if (fixture::fail_reserve)
    return false;
  if (disconnect_on_reserve)
    fixture::event(MQTT_EVENT_DISCONNECTED);
  reserved_until = until;
  return true;
}
static Outcome display(const char*) {
  ++effects;
  return Outcome::succeeded;
}
static Outcome disconnecting_display(const char*) {
  ++effects;
  fixture::event(MQTT_EVENT_DISCONNECTED);
  return Outcome::succeeded;
}
static std::string command(const char* id, int64_t issued) {
  char at[25], expiry[25];
  assert(format_utc(issued, at, sizeof(at)) && format_utc(issued + 15000, expiry, sizeof(expiry)));
  return std::string("{\"version\":1,\"messageId\":\"msg-1\",\"type\":\"device.command\","
                     "\"deviceId\":\"device-1\",\"commandId\":\"") +
         id + "\",\"executionId\":\"execution-1\",\"issuedAt\":\"" + at + "\",\"expiresAt\":\"" +
         expiry + "\",\"action\":{\"kind\":\"display.write\",\"text\":\"Hello\"}}";
}
static ClientConfig configuration() {
  ClientConfig c;
  c.device_id = "device-1";
  c.mqtt_host = "mqtt.example.test";
  c.mqtt_username = "ohm1.synthetic";
  c.mqtt_client_id = "openhuli-device-synthetic";
  c.mqtt_token = "synthetic-token";
  c.root_ca = "-----BEGIN CERTIFICATE-----synthetic";
  c.capabilities.display_characters = 32;
  c.display = display;
  c.reserve = reserve;
  return c;
}
int main() {
  auto config = configuration();
  OpenHuliClient huli;
  assert(!huli.begin(ClientConfig{}) && !fixture::active);
  assert(huli.begin(config) && !huli.begin(config));
  huli.loop();
  assert(!fixture::active && !huli.connected());
  assert(!huli.publish(Reading(true, 20, 50), huli.now())); // No offline storage.
  fixture::network = true;
  fixture::auto_ack = false;
  huli.loop();
  assert(fixture::active && !huli.connected()); // Wait for SUBACK, not just TCP connect.
  assert(fixture::config.transport == MQTT_TRANSPORT_OVER_SSL &&
         !fixture::config.skip_cert_common_name_check);
  assert(fixture::config.disable_auto_reconnect && !fixture::config.disable_clean_session);
  assert(fixture::config.protocol_ver == MQTT_PROTOCOL_V_3_1_1 && fixture::config.lwt_retain);
  std::cout << "WILL " << fixture::will << '\n';
  auto c = command("command-1", huli.now());
  fixture::command(c);
  huli.loop();
  assert(effects == 0);
  fixture::event(MQTT_EVENT_SUBSCRIBED);
  huli.loop();
  assert(huli.connected());
  std::cout << "MANIFEST " << fixture::publications.front().payload << '\n';
  assert(fixture::publications.back().payload.find("\"online\"") != std::string::npos);
  auto send = [&](const std::string& text) {
    fixture::command(text);
    huli.loop();
  };
  fixture::command(c, true);
  huli.loop();
  fixture::command(c, false, "openhuli/v1/devices/other/commands");
  huli.loop();
  assert(effects == 0);
  send(c);
  assert(effects == 1 && reserved_until == huli.now() + 15000);
  send(c);
  assert(effects == 1);
  std::string conflict = c;
  conflict.replace(conflict.find("Hello"), 5, "Other");
  size_t receipts = fixture::publications.size();
  send(conflict);
  assert(effects == 1 && fixture::publications.size() == receipts);
  fixture::fail_reserve = true;
  send(command("storage-failure", huli.now()));
  assert(effects == 1 &&
         fixture::publications.back().payload.find("\"failed\"") != std::string::npos);
  fixture::fail_reserve = false;
  // Queue is bounded to two, with no execution on the MQTT callback task.
  fixture::command(command("queue-1", huli.now()));
  fixture::command(command("queue-2", huli.now()));
  fixture::command(command("queue-overflow", huli.now()));
  assert(effects == 1);
  huli.loop();
  huli.loop();
  huli.loop();
  assert(effects == 3);
  auto queued = command("discard-on-disconnect", huli.now());
  fixture::command(queued);
  fixture::event(MQTT_EVENT_DISCONNECTED);
  huli.loop();
  assert(!huli.connected() && !fixture::active);
  receipts = fixture::publications.size();
  fixture::tick += 999;
  huli.loop();
  assert(!fixture::active);
  fixture::tick += 1001;
  fixture::auto_ack = true;
  huli.loop();
  assert(huli.connected());
  assert(effects == 3 && fixture::publications.size() == receipts + 2);
  send(queued);
  assert(effects == 3 &&
         fixture::publications.back().payload.find("\"expired\"") != std::string::npos);
  assert(huli.publish(Reading(true, -10.5f, 55), huli.now()));
  assert(!huli.publish(Reading(true, 20, 50), huli.now() - 60000));
  assert(!huli.publish(Reading(true, 20, 50), huli.now() + 1));
  assert(!huli.publish(Telemetry{}, huli.now()));
  fixture::wall_offset -= 10000;
  huli.loop();
  assert(!huli.connected() && huli.now() == 0);
  huli.end();
  assert(!fixture::active);
  fixture::wall_offset = 0;
  // Durable expiry from the previous boot prevents execution even if wall time shifts slightly.
  config.previous_boot_until = reserved_until;
  config.display = disconnecting_display;
  assert(huli.begin(config));
  huli.loop();
  assert(huli.connected());
  send(command("reboot-replay", huli.now()));
  assert(effects == 3);
  fixture::tick += 16000;
  huli.loop();
  receipts = fixture::publications.size();
  send(command("disconnect-during-effect", huli.now()));
  assert(effects == 4 && !huli.connected() && fixture::publications.size() == receipts);
  huli.end();
  config.previous_boot_until = 0;
  config.display = display;
  assert(huli.begin(config));
  huli.loop();
  disconnect_on_reserve = true;
  send(command("disconnect-before-effect", huli.now()));
  assert(effects == 4 && !huli.connected());
  huli.end();
  disconnect_on_reserve = false;
  // A missing SUBACK cannot make the client ready, and times out before retrying.
  fixture::auto_ack = false;
  assert(huli.begin(config));
  huli.loop();
  assert(!huli.connected());
  fixture::tick += 10000;
  huli.loop();
  assert(!fixture::active);
  fixture::tick += 1000;
  fixture::auto_ack = true;
  huli.loop();
  assert(huli.connected());
  huli.end();
  for (const auto& p : fixture::publications)
    assert(p.qos == 0);
  std::cout << "PASS client TLS/config, SUBACK, bounded input, command acknowledgements, reconnect "
               "and reboot fences\n";
}
