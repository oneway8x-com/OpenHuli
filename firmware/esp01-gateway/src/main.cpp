#include <Arduino.h>
#include <ArduinoMqttClient.h>
#include <ESP8266WiFi.h>
#include <LittleFS.h>
#include <OpenHuli.h>
#include <OpenHuliGateway.h>
#include <OpenHuliProtocol.h>
#include <WiFiClientSecureBearSSL.h>
#include <sys/time.h>
#include <time.h>
#if __has_include("config.local.h") && !defined(OPENHULI_LINK_CHECK)
#include "config.local.h"
#else
#include "config.example.h"
#endif
namespace {
using namespace openhuli::device;
BearSSL::WiFiClientSecure secure;
BearSSL::X509List* trust = nullptr;
MqttClient mqtt(secure);
ClockGuard clock_guard;
uint32_t last_ms = 0;
uint64_t monotonic_ms = 0;
uint32_t retry_at = 0, retry_ms = 1000, online_sequence = 0, announced_at = 0;
int64_t reserved_until = 0, floor_utc = 0, last_issued = 0;
bool configured = false, announced = false, pending = false, has_command = false;
Command last_command;
Result last_result;
char boot[32], manifest_topic[100], telemetry_topic[100], presence_topic[100], commands_topic[100],
    results_topic[100];
char wire[1025], output[1024];
int64_t utc(void*) {
  const uint32_t now = millis();
  monotonic_ms += uint32_t(now - last_ms);
  last_ms = now;
  timeval wall{};
  gettimeofday(&wall, nullptr);
  clock_guard.observe(int64_t(wall.tv_sec) * 1000 + wall.tv_usec / 1000, monotonic_ms);
  return clock_guard.now(monotonic_ms);
}
uint32_t tick(void*) { return millis(); }
bool serial_send(void*, const openhuli_serial::Frame& frame) {
  uint8_t bytes[openhuli_serial::max_frame];
  const size_t n = openhuli_serial::encode(frame, bytes);
  return n && Serial.write(bytes, n) == n;
}
bool publish(const char* topic, const char* text, bool retain = false) {
  if (!mqtt.connected())
    return false;
  const size_t n = strlen(text);
  return mqtt.beginMessage(topic, (unsigned long)n, retain, 0) &&
         mqtt.write((const uint8_t*)text, n) == n && mqtt.endMessage();
}
bool reserve(int64_t until) {
  if (until <= reserved_until)
    return true;
  // LittleFS uses copy-on-write metadata; only a committed rename advances the watermark.
  File next = LittleFS.open("/dispatch.next", "w");
  if (!next)
    return false;
  const String text =
      String((unsigned long)(until / 1000)) + ":" + String((unsigned)(until % 1000));
  if (next.print(text) != text.length()) {
    next.close();
    return false;
  }
  next.flush();
  next.close();
  if (!LittleFS.rename("/dispatch.next", "/dispatch"))
    return false;
  File verify = LittleFS.open("/dispatch", "r");
  if (!verify || verify.readString() != text)
    return false;
  reserved_until = until;
  return true;
}
void sample(void*, const openhuli_serial::LocalSample& local) {
  if (!announced)
    return;
  Telemetry telemetry;
  const openhuli_serial::Sensor values[] = {local.temperature, local.humidity};
  SensorValue* target[] = {&telemetry.temperature, &telemetry.humidity};
  for (uint8_t i = 0; i < 2; ++i) {
    if (values[i].state > openhuli_serial::unavailable ||
        (!(config::sensors & (1 << i)) && values[i].state != openhuli_serial::omitted))
      return;
    *target[i] = SensorValue(SensorStatus(values[i].state), float(values[i].centi) / 100);
  }
  if (write_telemetry(output, sizeof(output), config::device_id, boot, local.sequence,
                      local.sampled_at, telemetry))
    publish(telemetry_topic, output);
}
void completed(void*, openhuli_serial::Status status, int64_t at) {
  if (!pending)
    return;
  pending = false;
  const Outcome outcomes[] = {Outcome::succeeded, Outcome::failed, Outcome::expired,
                              Outcome::unsupported, Outcome::unknown};
  last_result =
      Result(status <= openhuli_serial::unknown ? outcomes[status] : Outcome::unknown, at);
  if (announced &&
      write_result(output, sizeof(output), config::device_id, last_command, last_result))
    publish(results_topic, output);
}
void node_state(void*, bool online);
openhuli_serial::Gateway gateway(serial_send, tick, utc, nullptr, config::sensors,
                                 config::display_limit, sample, completed, node_state);
void node_state(void*, bool online) {
  if (!online) {
    if (announced && mqtt.connected() && utc(nullptr) &&
        write_presence(output, sizeof(output), config::device_id, boot, UINT32_MAX, false,
                       utc(nullptr)))
      publish(presence_topic, output, true);
    announced = false;
    secure.stop();
    return;
  }
  Capabilities caps;
  caps.temperature = config::sensors & 1;
  caps.humidity = config::sensors & 2;
  caps.display_characters = config::display_limit;
  floor_utc = utc(nullptr) > reserved_until ? utc(nullptr) : reserved_until;
  last_issued = floor_utc;
  has_command = pending = false;
  if (!write_manifest(output, sizeof(output), config::device_id, boot, caps, "esp01-gateway-v1") ||
      !publish(manifest_topic, output)) {
    mqtt.stop();
    return;
  }
  announced = write_presence(output, sizeof(output), config::device_id, boot, ++online_sequence,
                             true, utc(nullptr)) &&
              publish(presence_topic, output, true);
  announced_at = millis();
  if (!announced)
    mqtt.stop();
}
bool same(const Command& a, const Command& b) {
  return !strcmp(a.message_id, b.message_id) && !strcmp(a.command_id, b.command_id) &&
         !strcmp(a.execution_id, b.execution_id) && a.issued_at == b.issued_at &&
         a.expires_at == b.expires_at && a.action == b.action &&
         a.text_supported == b.text_supported && !strcmp(a.text, b.text);
}
void receive_command(int size) {
  if (!announced || size <= 0 || size > 1024 || mqtt.messageRetain() ||
      mqtt.messageTopic() != commands_topic) {
    while (mqtt.available())
      mqtt.read();
    return;
  }
  const size_t count = mqtt.readBytes(wire, size);
  if (count != size_t(size))
    return;
  wire[count] = 0;
  Command c;
  if (!parse_command(wire, count, config::device_id, c))
    return;
  if (has_command && !strcmp(c.command_id, last_command.command_id)) {
    if (!pending && same(c, last_command) &&
        write_result(output, sizeof(output), config::device_id, c, last_result))
      publish(results_topic, output);
    return;
  }
  if (pending)
    return;
  const int64_t now = utc(nullptr);
  Result rejected(Outcome::expired, now);
  if (!now || c.issued_at < floor_utc || c.issued_at <= last_issued || c.issued_at > now ||
      c.expires_at <= now || c.expires_at - c.issued_at > 30000) {
    if (write_result(output, sizeof(output), config::device_id, c, rejected))
      publish(results_topic, output);
    return;
  }
  if (c.action == Action::display &&
      (!config::display_limit || !c.text_supported || strlen(c.text) > config::display_limit)) {
    rejected.outcome = Outcome::unsupported;
    if (write_result(output, sizeof(output), config::device_id, c, rejected))
      publish(results_topic, output);
    return;
  }
  last_command = c;
  has_command = true;
  last_result = Result(Outcome::unknown, now);
  last_issued = c.issued_at;
  if (!reserve(c.expires_at) || !gateway.connected() || utc(nullptr) >= c.expires_at) {
    if (write_result(output, sizeof(output), config::device_id, c, last_result))
      publish(results_topic, output);
    return;
  }
  pending = true;
  if (!gateway.command(c.action == Action::display, c.action == Action::display ? c.text : "",
                       c.expires_at))
    completed(nullptr, openhuli_serial::unknown, utc(nullptr));
}
} // namespace
void setup() {
  Serial.begin(19200);
  Serial.setDebugOutput(false);
  openhuli::ClientConfig validation;
  validation.device_id = config::device_id;
  validation.mqtt_host = config::mqtt_host;
  validation.mqtt_port = config::mqtt_port;
  validation.mqtt_username = config::mqtt_username;
  validation.mqtt_client_id = config::mqtt_client_id;
  validation.mqtt_token = config::mqtt_token;
  validation.root_ca = config::root_ca;
  // Validate display behavior separately; the cloud codec still bounds its owner-advertised length.
  configured = config::enabled && config::sensors <= 3 && config::display_limit <= 32 &&
               openhuli::valid_config(validation);
  if (!configured || !LittleFS.begin()) {
    configured = false;
    return;
  } // Never auto-format storage.
  if (LittleFS.exists("/dispatch")) {
    File file = LittleFS.open("/dispatch", "r");
    if (!file || file.size() > 32) {
      configured = false;
      return;
    }
    const String text = file.readString();
    unsigned long seconds;
    unsigned ms;
    int used = 0;
    if (sscanf(text.c_str(), "%lu:%u%n", &seconds, &ms, &used) != 2 || used != int(text.length()) ||
        ms > 999) {
      configured = false;
      return;
    }
    reserved_until = int64_t(seconds) * 1000 + ms;
    if (reserved_until < 1704067200000LL || reserved_until >= 4102444800000LL) {
      configured = false;
      return;
    }
  }
  trust = new BearSSL::X509List(config::root_ca);
  secure.setTrustAnchors(trust);
  secure.setSSLVersion(BR_TLS12, BR_TLS12);
  secure.setTimeout(2000);
  mqtt.setTimeout(1000);
  mqtt.setId(config::mqtt_client_id);
  mqtt.setUsernamePassword(config::mqtt_username, config::mqtt_token);
  mqtt.setCleanSession(true);
  mqtt.setConnectionTimeout(5000);
  mqtt.setKeepAliveInterval(15000);
  mqtt.onMessage(receive_command);
  auto topic = [](char* out, const char* suffix) {
    snprintf(out, 100, "openhuli/v1/devices/%s/%s", config::device_id, suffix);
  };
  topic(manifest_topic, "manifest");
  topic(telemetry_topic, "telemetry");
  topic(presence_topic, "presence");
  topic(commands_topic, "commands");
  topic(results_topic, "results");
  WiFi.mode(WIFI_STA);
  WiFi.begin(config::wifi_ssid, config::wifi_password);
  configTime(0, 0, "pool.ntp.org");
}
void loop() {
  if (!configured) {
    delay(20);
    return;
  }
  const uint32_t now = millis();
  monotonic_ms += uint32_t(now - last_ms);
  last_ms = now;
  timeval wall{};
  gettimeofday(&wall, nullptr);
  clock_guard.observe(int64_t(wall.tv_sec) * 1000 + wall.tv_usec / 1000, monotonic_ms);
  if (!utc(nullptr) || WiFi.status() != WL_CONNECTED) {
    gateway.reset();
    announced = false;
    mqtt.stop();
    delay(10);
    return;
  }
  if (!mqtt.connected()) {
    gateway.reset();
    announced = false;
    if (uint32_t(now - retry_at) < retry_ms) {
      delay(1);
      return;
    }
    retry_at = now;
    retry_ms = retry_ms < 15000 ? retry_ms * 2 : 30000;
    snprintf(boot, sizeof(boot), "esp01-%08lx-%08lx", (unsigned long)os_random(),
             (unsigned long)os_random());
    online_sequence = 0;
    if (!write_presence(output, sizeof(output), config::device_id, boot, UINT32_MAX, false,
                        utc(nullptr)))
      return;
    const size_t will_size = strlen(output);
    if (!mqtt.beginWill(presence_topic, (unsigned short)will_size, true, 0) ||
        mqtt.print(output) != will_size || !mqtt.endWill())
      return;
    if (!mqtt.connect(config::mqtt_host, config::mqtt_port) || !mqtt.subscribe(commands_topic, 0) ||
        mqtt.subscribeQoS() > 2) {
      mqtt.stop();
      return;
    }
    uint8_t nonce[16];
    for (uint8_t i = 0; i < 16; ++i)
      nonce[i] = uint8_t(os_random());
    gateway.begin(nonce);
    retry_ms = 1000;
  }
  mqtt.poll();
  uint8_t count = 0;
  while (Serial.available() && count++ < 96)
    gateway.feed(uint8_t(Serial.read()));
  gateway.poll();
  if (announced && uint32_t(now - announced_at) >= 30000) {
    announced_at = now;
    if (online_sequence >= UINT32_MAX - 1 ||
        !write_presence(output, sizeof(output), config::device_id, boot, ++online_sequence, true,
                        utc(nullptr)) ||
        !publish(presence_topic, output, true)) {
      gateway.reset();
      mqtt.stop();
    }
  }
  delay(1);
}
