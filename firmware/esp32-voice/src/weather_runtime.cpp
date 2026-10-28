#include "weather_runtime.h"
#include "command_json.h"
#include "hardware_config.h"
#include "local_config.h"
#include "voice_core.h"
#include "weather_core.h"
#include <Arduino.h>
#include <LiquidCrystal.h>
#include <Preferences.h>
#include <WiFi.h>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <driver/rmt.h>
#include <esp_timer.h>
#include <mqtt_client.h>
#include <new>
#include <sys/time.h>
namespace openhuli::weather {
namespace {
constexpr uint32_t sample_interval = 60000;
constexpr size_t lcd_characters = 32;
constexpr size_t queue_capacity = 2;
struct Inbound {
  uint32_t epoch;
  size_t length;
  char bytes[command_bytes + 1];
};
StaticQueue_t queue_storage;
uint8_t queue_bytes[queue_capacity * sizeof(Inbound)];
QueueHandle_t commands = nullptr;
TaskHandle_t worker_handle = nullptr;
std::atomic<bool> online{false}, accepting{false};
std::atomic<uint32_t> epoch{0}, rejected_packets{0};
Packet packet;
Receiver receiver;
ClockGuard clock_guard;
Preferences journal;
bool journal_ready = false;
int64_t reserved_until = 0;
bool reserve_effect(int64_t until) {
  if (!journal_ready)
    return false;
  if (until <= reserved_until)
    return true;
  if (journal.putULong64("until", uint64_t(until)) != sizeof(uint64_t))
    return false;
  reserved_until = until;
  return true;
}
RingbufHandle_t pulses = nullptr;
esp_mqtt_client_handle_t client = nullptr; // Worker-owned; the callback only passes bounded input.
char boot[32], manifest_topic[100], telemetry_topic[100], presence_topic[100], commands_topic[100],
    results_topic[100];
char will[512];
alignas(LiquidCrystal) uint8_t lcd_storage[sizeof(LiquidCrystal)];
LiquidCrystal* lcd = nullptr; // Never construct the GPIO-driving library object before validation.
int64_t wall_utc() {
  timeval t{};
  gettimeofday(&t, nullptr);
  return int64_t(t.tv_sec) * 1000 + t.tv_usec / 1000;
}
int64_t utc_now() { return clock_guard.now(uint64_t(esp_timer_get_time() / 1000)); }
bool clock_ready() { return utc_now() > 0; }
Outcome display_write(const char* text) {
  if (!lcd)
    return Outcome::unsupported;
  const size_t length = std::strlen(text);
  if (!length || length > lcd_characters)
    return Outcome::unsupported;
  for (size_t i = 0; i < length; ++i)
    if (text[i] < 32 || text[i] > 126)
      return Outcome::unsupported;
  for (size_t row = 0; row < 2; ++row) {
    lcd->setCursor(0, row);
    for (size_t column = 0; column < 16; ++column) {
      const size_t index = row * 16 + column;
      lcd->write(uint8_t(index < length ? text[index] : ' '));
    }
  }
  // Write-only HD44780: completed GPIO sequence, not electrical/pixel readback.
  return Outcome::succeeded;
}
bool init_sensor() {
  const auto pin = static_cast<gpio_num_t>(config::dht_data);
  rmt_config_t settings{};
  settings.rmt_mode = RMT_MODE_RX;
  settings.channel = RMT_CHANNEL_0;
  settings.gpio_num = pin;
  settings.clk_div = 80;
  settings.mem_block_num = 1;
  settings.rx_config.filter_en = true;
  settings.rx_config.filter_ticks_thresh = 80;
  settings.rx_config.idle_threshold = 200;
  if (rmt_config(&settings) != ESP_OK || rmt_driver_install(RMT_CHANNEL_0, 512, 0) != ESP_OK)
    return false;
  if (rmt_get_ringbuf_handle(RMT_CHANNEL_0, &pulses) != ESP_OK || !pulses) {
    rmt_driver_uninstall(RMT_CHANNEL_0);
    return false;
  }
  gpio_set_pull_mode(pin, GPIO_PULLUP_ONLY);
  return true;
}
Reading sample_sensor() {
  const auto pin = static_cast<gpio_num_t>(config::dht_data);
  rmt_rx_stop(RMT_CHANNEL_0);
  size_t old_size = 0;
  while (void* old = xRingbufferReceive(pulses, &old_size, 0))
    vRingbufferReturnItem(pulses, old);
  // Open drain avoids driving high against the sensor. RMT captures pulse timing in hardware.
  gpio_set_level(pin, 0);
  gpio_set_direction(pin, GPIO_MODE_INPUT_OUTPUT_OD);
  vTaskDelay(pdMS_TO_TICKS(20));
  if (rmt_rx_start(RMT_CHANNEL_0, true) != ESP_OK) {
    gpio_set_level(pin, 1);
    return {};
  }
  gpio_set_level(pin, 1);
  size_t bytes = 0;
  auto* items = static_cast<rmt_item32_t*>(xRingbufferReceive(pulses, &bytes, pdMS_TO_TICKS(15)));
  rmt_rx_stop(RMT_CHANNEL_0);
  Reading result{};
  if (items) {
    Pulse captured[96];
    size_t count = 0;
    for (size_t i = 0; i < bytes / sizeof(rmt_item32_t) && count + 2 <= 96; ++i) {
      if (items[i].duration0)
        captured[count++] = {bool(items[i].level0), uint16_t(items[i].duration0)};
      if (items[i].duration1)
        captured[count++] = {bool(items[i].level1), uint16_t(items[i].duration1)};
    }
    result = decode_dht11(captured, count);
    vRingbufferReturnItem(pulses, items);
  }
  return result;
}
void mqtt_event(void*, esp_event_base_t, int32_t id, void* data) {
  auto* e = static_cast<esp_mqtt_event_t*>(data);
  switch (id) {
  case MQTT_EVENT_CONNECTED:
    packet.clear();
    epoch.fetch_add(1);
    online.store(true);
    break;
  case MQTT_EVENT_DISCONNECTED:
    accepting.store(false);
    online.store(false);
    epoch.fetch_add(1);
    packet.clear();
    if (commands)
      xQueueReset(commands);
    break;
  case MQTT_EVENT_DATA: {
    if (!accepting.load() || e->data_len < 0 || e->total_data_len < 0 || e->current_data_offset < 0)
      return;
    if (e->current_data_offset == 0 &&
        (!e->topic || e->topic_len != int(std::strlen(commands_topic)) ||
         std::memcmp(e->topic, commands_topic, e->topic_len))) {
      packet.clear();
      return;
    }
    if (!packet.append(e->data, size_t(e->data_len), size_t(e->current_data_offset),
                       size_t(e->total_data_len), e->retain)) {
      rejected_packets.fetch_add(1);
      return;
    }
    if (packet.complete()) {
      static Inbound inbound; // Callback-owned, avoiding a 4 KiB temporary on the MQTT stack.
      inbound.epoch = epoch.load();
      inbound.length = packet.size();
      std::memcpy(inbound.bytes, packet.data(), packet.size() + 1);
      if (xQueueSend(commands, &inbound, 0) != pdTRUE)
        rejected_packets.fetch_add(1);
      packet.clear();
    }
    break;
  }
  default:
    break; // The SDK owns framing, TLS and keepalive; never print credential-bearing events.
  }
}
bool publish(const char* topic, const char* text, bool retain = false) {
  // QoS 0, no SDK offline enqueue/retransmission. Failed receipts stay uncertain on the server.
  return online.load() && esp_mqtt_client_publish(client, topic, text, 0, 0, retain) >= 0;
}
void stop_client(bool graceful, uint32_t presence_sequence) {
  accepting.store(false);
  if (!client)
    return;
  if (graceful && online.load()) {
    char text[512];
    if (write_presence(text, sizeof(text), config::device_id, boot, presence_sequence, false,
                       utc_now()))
      publish(presence_topic, text, true);
    esp_mqtt_client_disconnect(client);
  }
  esp_mqtt_client_stop(client);
  esp_mqtt_client_destroy(client);
  client = nullptr;
  online.store(false);
  epoch.fetch_add(1);
  xQueueReset(commands);
}
void worker(void*) {
  if (config::display_enabled) {
    lcd = new (lcd_storage) LiquidCrystal(config::lcd_rs, config::lcd_enable, config::lcd_d4,
                                          config::lcd_d5, config::lcd_d6, config::lcd_d7);
    lcd->begin(16, 2);
    display_write("Waiting for DHT11");
  }
  journal_ready = journal.begin("openhuli_cmd", false);
  if (journal_ready)
    reserved_until = int64_t(journal.getULong64("until", 0));
  if (reserved_until < 0 || reserved_until >= 4102444800000LL)
    journal_ready = false;
  const bool sensor_ready = init_sensor();
  Reading latest{};
  int64_t sampled_at = 0;
  uint32_t sampled_tick = millis() - sample_interval + 2000, retry_at = millis(), connect_at = 0,
           presence_sequence = 0, telemetry_sequence = 0, diagnostic_at = 0;
  uint32_t retry_ms = 1000;
  bool pending_sample = false, announced = false;
  char output[1024];
  Inbound inbound;
  for (;;) {
    const uint32_t now = millis();
    clock_guard.observe(wall_utc(), uint64_t(esp_timer_get_time() / 1000));
    if (uint32_t(now - sampled_tick) >= sample_interval) {
      sampled_tick = now;
      latest = sensor_ready ? sample_sensor() : Reading{};
      sampled_at = clock_ready() ? utc_now() : 0;
      pending_sample = true;
      Serial.printf("weather sensor=%s\n", latest.valid ? "measured" : "read_failed");
      if (lcd) {
        char label[33];
        if (latest.valid)
          std::snprintf(label, sizeof(label), "Temp %4.1f C     Hum  %4.1f %%",
                        double(latest.temperature), double(latest.humidity));
        else
          std::snprintf(label, sizeof(label), "Sensor read error");
        display_write(label);
      }
    }
    const bool network = WiFi.status() == WL_CONNECTED && clock_ready();
    if (client &&
        (!network || (!online.load() && (announced || uint32_t(now - connect_at) >= 10000)))) {
      stop_client(network, presence_sequence + 1);
      announced = false;
      retry_at = now;
      retry_ms = retry_ms < 15000 ? retry_ms * 2 : 30000;
    }
    if (!client && network && uint32_t(now - retry_at) >= retry_ms) {
      // Each CONNECT has a fresh online/Will pair; sequence never wraps within a boot.
      if (presence_sequence > UINT32_MAX - 2) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        continue;
      }
      presence_sequence += 2;
      if (!write_presence(will, sizeof(will), config::device_id, boot, presence_sequence + 1, false,
                          utc_now()))
        continue;
      esp_mqtt_client_config_t settings{};
      settings.host = config::mqtt_host;
      settings.port = config::mqtt_port;
      settings.transport = MQTT_TRANSPORT_OVER_SSL;
      settings.cert_pem = config::mqtt_root_ca;
      settings.skip_cert_common_name_check = false;
      settings.client_id = config::mqtt_client_id;
      settings.username = config::mqtt_username;
      settings.password = config::device_mqtt_token;
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
      connect_at = now;
      if (client) {
        if (esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, mqtt_event, nullptr) != ESP_OK ||
            esp_mqtt_client_start(client) != ESP_OK)
          stop_client(false, presence_sequence + 1);
      }
      if (!client)
        retry_at = now;
    }
    if (client && online.load() && !announced) {
      receiver.connected(utc_now(), reserved_until);
      const bool manifest = write_manifest(output, sizeof(output), config::device_id, boot,
                                           config::voice_enabled, lcd ? lcd_characters : 0) &&
                            publish(manifest_topic, output);
      const bool subscribed = esp_mqtt_client_subscribe(client, commands_topic, 0) >= 0;
      accepting.store(manifest && subscribed);
      const bool presence = write_presence(output, sizeof(output), config::device_id, boot,
                                           presence_sequence, true, utc_now()) &&
                            publish(presence_topic, output, true);
      if (!manifest || !subscribed || !presence) {
        stop_client(true, presence_sequence + 1);
        retry_at = now;
      } else {
        announced = true;
        retry_ms = 1000;
      }
    }
    if (client && announced && online.load()) {
      if (pending_sample) {
        // At most one fresh sample; never drain an offline backlog or restamp an old measurement.
        if (sampled_at && uint32_t(now - sampled_tick) < sample_interval &&
            telemetry_sequence != UINT32_MAX &&
            write_telemetry(output, sizeof(output), config::device_id, boot, telemetry_sequence++,
                            sampled_at, latest))
          publish(telemetry_topic, output);
        pending_sample = false;
      }
      if (xQueueReceive(commands, &inbound, 0) == pdTRUE && inbound.epoch == epoch.load()) {
        Command command;
        if (parse_command(inbound.bytes, inbound.length, config::device_id, command) &&
            accepting.load()) {
          const Result result =
              receiver.receive(command, utc_now(), clock_ready(), lcd ? display_write : nullptr,
                               lcd ? lcd_characters : 0, utc_now, reserve_effect);
          if (write_result(output, sizeof(output), config::device_id, command, result))
            publish(results_topic, output);
        } else
          rejected_packets.fetch_add(1);
      }
    }
    if (uint32_t(now - diagnostic_at) >= 10000) {
      diagnostic_at = now;
      Serial.printf("weather online=%u rejected=%lu stack=%u heap=%u\n", unsigned(online.load()),
                    (unsigned long)rejected_packets.load(),
                    unsigned(uxTaskGetStackHighWaterMark(nullptr)), ESP.getFreeHeap());
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
} // namespace
bool validate_config() {
  if (!config::weather_enabled)
    return !config::display_enabled;
  if (!safe_pin(config::dht_data, true) || !valid_id(config::device_id) ||
      !safe_host(config::mqtt_host) || !config::mqtt_port || config::mqtt_port > 65535 ||
      !safe_token(config::device_mqtt_token) || std::strncmp(config::mqtt_username, "ohm1.", 5) ||
      std::strlen(config::mqtt_username) > 512 ||
      std::strncmp(config::mqtt_client_id, "openhuli-device-", 15) ||
      std::strlen(config::mqtt_client_id) > 79 ||
      !std::strstr(config::mqtt_root_ca, "-----BEGIN CERTIFICATE-----"))
    return false;
  const int weather_pins[] = {config::dht_data, config::lcd_rs, config::lcd_enable, config::lcd_d4,
                              config::lcd_d5,   config::lcd_d6, config::lcd_d7};
  const int voice_pins[] = {config::mic_bclk, config::mic_ws, config::mic_data, config::button,
                            config::led};
  const size_t count = config::display_enabled ? 7 : 1;
  if (config::display_enabled && !config::display_confirmed)
    return false;
  for (size_t i = 0; i < count; ++i) {
    if (!safe_pin(weather_pins[i], true))
      return false;
    for (size_t j = 0; j < i; ++j)
      if (weather_pins[i] == weather_pins[j])
        return false;
    if (config::voice_enabled)
      for (int pin : voice_pins)
        if (weather_pins[i] == pin)
          return false;
  }
  return true;
}
bool begin() {
  if (!config::weather_enabled)
    return true;
  if (!config::hardware_confirmed || !validate_config())
    return false;
  commands = xQueueCreateStatic(queue_capacity, sizeof(Inbound), queue_bytes, &queue_storage);
  if (!commands)
    return false;
  std::snprintf(boot, sizeof(boot), "s2w-%08lx-%08lx", (unsigned long)esp_random(),
                (unsigned long)esp_random());
  auto topic = [](char* out, size_t size, const char* suffix) {
    std::snprintf(out, size, "openhuli/v1/devices/%s/%s", config::device_id, suffix);
  };
  topic(manifest_topic, sizeof(manifest_topic), "manifest");
  topic(telemetry_topic, sizeof(telemetry_topic), "telemetry");
  topic(presence_topic, sizeof(presence_topic), "presence");
  topic(commands_topic, sizeof(commands_topic), "commands");
  topic(results_topic, sizeof(results_topic), "results");
  return xTaskCreate(worker, "weather", 12288, nullptr, 1, &worker_handle) == pdPASS;
}
} // namespace openhuli::weather
