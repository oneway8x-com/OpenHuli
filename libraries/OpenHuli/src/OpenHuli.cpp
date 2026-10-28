#include "OpenHuli.h"
#if defined(ESP32)
#include <WiFi.h>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <esp_idf_version.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <mqtt_client.h>
#include <new>
#include <sys/time.h>
#if ESP_IDF_VERSION_MAJOR != 4
#error "This OpenHuli transport supports ESP-IDF 4.4 / Arduino ESP32 core 2.0.17"
#endif
namespace openhuli {
using namespace device;
namespace {
uint64_t monotonic_ms() { return uint64_t(esp_timer_get_time() / 1000); }
int64_t wall_utc() {
  timeval t{};
  gettimeofday(&t, nullptr);
  return int64_t(t.tv_sec) * 1000 + t.tv_usec / 1000;
}
} // namespace
struct OpenHuliClient::Impl {
  ClientConfig config;
  struct Inbound {
    uint32_t epoch;
    size_t length;
    char bytes[command_bytes + 1];
  } inbound{}, incoming{};
  QueueHandle_t commands = nullptr;
  esp_mqtt_client_handle_t client = nullptr;
  std::atomic<bool> online{false}, accepting{false};
  std::atomic<uint32_t> epoch{0};
  std::atomic<int> acknowledged{-1};
  Packet packet;
  Receiver receiver;
  ClockGuard clock;
  char boot[32]{}, manifest_topic[100]{}, telemetry_topic[100]{}, presence_topic[100]{},
      commands_topic[100]{}, results_topic[100]{}, will[512]{}, output[1024]{};
  uint64_t retry_at = 0, connect_at = 0;
  uint32_t retry_ms = 0, presence_sequence = 0, telemetry_sequence = 0;
  int subscription = -1;
  bool announced = false;
  int64_t now() const { return clock.now(monotonic_ms()); }
  static int64_t read_clock(void* self) {
    auto& owner = *static_cast<Impl*>(self);
    return owner.online.load() && owner.accepting.load() &&
                   owner.inbound.epoch == owner.epoch.load()
               ? owner.now()
               : 0;
  }
  static void mqtt_event(void* context, esp_event_base_t, int32_t id, void* data) {
    auto& self = *static_cast<Impl*>(context);
    auto* e = static_cast<esp_mqtt_event_t*>(data);
    switch (id) {
    case MQTT_EVENT_CONNECTED:
      self.packet.clear();
      self.epoch.fetch_add(1);
      self.online.store(true);
      break;
    case MQTT_EVENT_SUBSCRIBED:
      self.acknowledged.store(e->msg_id);
      break;
    case MQTT_EVENT_DISCONNECTED:
      self.accepting.store(false);
      self.online.store(false);
      self.epoch.fetch_add(1);
      self.packet.clear();
      xQueueReset(self.commands);
      break;
    case MQTT_EVENT_DATA:
      if (!self.accepting.load() || e->data_len < 0 || e->total_data_len < 0 ||
          e->current_data_offset < 0)
        return;
      if (e->current_data_offset == 0 &&
          (!e->topic || e->topic_len != int(std::strlen(self.commands_topic)) ||
           std::memcmp(e->topic, self.commands_topic, size_t(e->topic_len)))) {
        self.packet.clear();
        return;
      }
      if (!self.packet.append(e->data, size_t(e->data_len), size_t(e->current_data_offset),
                              size_t(e->total_data_len), e->retain))
        return;
      if (self.packet.complete()) {
        // Callback-owned storage; the owner loop receives into a separate buffer.
        auto& incoming = self.incoming;
        incoming.epoch = self.epoch.load();
        incoming.length = self.packet.size();
        std::memcpy(incoming.bytes, self.packet.data(), incoming.length + 1);
        xQueueSend(self.commands, &incoming, 0); // Full queue drops work; never confirms an effect.
        self.packet.clear();
      }
      break;
    default:
      break; // Never print credential-bearing SDK events.
    }
  }
  bool publish(const char* topic, const char* payload, bool retain = false) {
    // QoS 0 never queues offline/retransmitted effects or samples. Receipts confirm device actions.
    return online.load() && esp_mqtt_client_publish(client, topic, payload, 0, 0, retain) >= 0;
  }
  void stop(bool graceful) {
    accepting.store(false);
    if (client) {
      if (graceful && online.load() && now() &&
          write_presence(output, sizeof(output), config.device_id, boot, presence_sequence + 1,
                         false, now())) {
        publish(presence_topic, output, true);
        esp_mqtt_client_disconnect(client);
      }
      // Owner task only. stop joins the MQTT task before callback-owned storage is reset.
      esp_mqtt_client_stop(client);
      esp_mqtt_client_destroy(client);
      client = nullptr;
    }
    online.store(false);
    epoch.fetch_add(1);
    packet.clear();
    xQueueReset(commands);
    announced = false;
    subscription = -1;
    acknowledged.store(-1);
  }
  void retry(uint64_t tick, bool graceful) {
    stop(graceful);
    retry_at = tick;
    retry_ms = retry_ms ? (retry_ms < 15000 ? retry_ms * 2 : 30000) : 1000;
  }
  void loop() {
    const uint64_t tick = monotonic_ms();
    clock.observe(wall_utc(), tick);
    const bool network = WiFi.status() == WL_CONNECTED && now() > 0;
    if (client &&
        (!network || (!online.load() && announced) || (!announced && tick - connect_at >= 10000)))
      retry(tick, network);
    if (!network)
      return;
    if (!client && tick - retry_at >= retry_ms) {
      if (presence_sequence > UINT32_MAX - 2)
        return;
      presence_sequence += 2;
      if (!write_presence(will, sizeof(will), config.device_id, boot, presence_sequence + 1, false,
                          now()))
        return;
      esp_mqtt_client_config_t settings{};
      settings.host = config.mqtt_host;
      settings.port = config.mqtt_port;
      settings.transport = MQTT_TRANSPORT_OVER_SSL;
      settings.cert_pem = config.root_ca;
      settings.skip_cert_common_name_check = false;
      settings.client_id = config.mqtt_client_id;
      settings.username = config.mqtt_username;
      settings.password = config.mqtt_token;
      settings.lwt_topic = presence_topic;
      settings.lwt_msg = will;
      settings.lwt_retain = 1;
      settings.disable_clean_session = 0;
      settings.disable_auto_reconnect = true;
      settings.keepalive = 15;
      settings.task_prio = 1;
      settings.task_stack = 8192;
      settings.buffer_size = 1024;
      settings.out_buffer_size = 1024;
      settings.network_timeout_ms = 1000;
      settings.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
      client = esp_mqtt_client_init(&settings);
      connect_at = tick;
      if (!client ||
          esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, mqtt_event, this) != ESP_OK ||
          esp_mqtt_client_start(client) != ESP_OK)
        retry(tick, false);
    }
    if (!client || !online.load())
      return;
    if (subscription < 0) {
      receiver.connected(now(), config.previous_boot_until);
      if (!write_manifest(output, sizeof(output), config.device_id, boot, config.capabilities,
                          config.firmware_version) ||
          !publish(manifest_topic, output)) {
        retry(tick, true);
        return;
      }
      subscription = esp_mqtt_client_subscribe(client, commands_topic, 0);
      if (subscription < 0) {
        retry(tick, true);
        return;
      }
    }
    if (!announced && acknowledged.load() == subscription) {
      if (!write_presence(output, sizeof(output), config.device_id, boot, presence_sequence, true,
                          now()) ||
          !publish(presence_topic, output, true)) {
        retry(tick, true);
        return;
      }
      announced = true;
      accepting.store(true);
      retry_ms = 1000;
    }
    if (!announced || !accepting.load())
      return;
    if (xQueueReceive(commands, &inbound, 0) == pdTRUE && inbound.epoch == epoch.load()) {
      Command command;
      if (!parse_command(inbound.bytes, inbound.length, config.device_id, command))
        return;
      // Recheck after parsing and immediately before the receiver reserves/dispatches an effect.
      if (!online.load() || !accepting.load() || inbound.epoch != epoch.load())
        return;
      const auto result = receiver.receive(command, now(), now() > 0, config.display,
                                           config.capabilities.display_characters, nullptr,
                                           config.reserve, this, read_clock);
      if (online.load() && inbound.epoch == epoch.load() &&
          write_result(output, sizeof(output), config.device_id, command, result))
        publish(results_topic, output);
    }
  }
};
OpenHuliClient::~OpenHuliClient() { end(); }
bool OpenHuliClient::begin(const ClientConfig& config) {
  if (impl_ || !valid_config(config))
    return false;
  auto* instance = new (std::nothrow) Impl;
  if (!instance)
    return false;
  instance->config = config;
  instance->commands = xQueueCreate(2, sizeof(Impl::Inbound));
  if (!instance->commands) {
    delete instance;
    return false;
  }
  std::snprintf(instance->boot, sizeof(instance->boot), "esp-%08lx-%08lx",
                (unsigned long)esp_random(), (unsigned long)esp_random());
  auto topic = [&](char* out, size_t size, const char* suffix) {
    std::snprintf(out, size, "openhuli/v1/devices/%s/%s", config.device_id, suffix);
  };
  topic(instance->manifest_topic, sizeof(instance->manifest_topic), "manifest");
  topic(instance->telemetry_topic, sizeof(instance->telemetry_topic), "telemetry");
  topic(instance->presence_topic, sizeof(instance->presence_topic), "presence");
  topic(instance->commands_topic, sizeof(instance->commands_topic), "commands");
  topic(instance->results_topic, sizeof(instance->results_topic), "results");
  impl_ = instance;
  return true;
}
void OpenHuliClient::loop() {
  if (impl_)
    impl_->loop();
}
bool OpenHuliClient::connected() const {
  return impl_ && impl_->online.load() && impl_->accepting.load() && impl_->now() > 0;
}
int64_t OpenHuliClient::now() const { return impl_ ? impl_->now() : 0; }
bool OpenHuliClient::publish(const Telemetry& sample, int64_t sampled_at) {
  if (!connected() || sampled_at <= 0 || sampled_at > now() || now() - sampled_at >= 60000 ||
      impl_->telemetry_sequence == UINT32_MAX ||
      (!impl_->config.capabilities.temperature &&
       sample.temperature.status != SensorStatus::omitted) ||
      (!impl_->config.capabilities.humidity && sample.humidity.status != SensorStatus::omitted))
    return false;
  return write_telemetry(impl_->output, sizeof(impl_->output), impl_->config.device_id, impl_->boot,
                         impl_->telemetry_sequence++, sampled_at, sample) &&
         impl_->publish(impl_->telemetry_topic, impl_->output);
}
bool OpenHuliClient::publish(Reading reading, int64_t sampled_at) {
  Telemetry sample;
  const auto status = reading.valid ? SensorStatus::measured : SensorStatus::read_failed;
  sample.temperature = {status, reading.temperature};
  sample.humidity = {status, reading.humidity};
  return publish(sample, sampled_at);
}
void OpenHuliClient::end() {
  if (!impl_)
    return;
  impl_->stop(true);
  vQueueDelete(impl_->commands);
  delete impl_;
  impl_ = nullptr;
}
} // namespace openhuli

#endif // ESP32 direct transport; ESP8266 gateways use the shared protocol only.
