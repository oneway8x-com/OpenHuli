#include "weather_runtime.h"
#include "hardware_config.h"
#include "local_config.h"
#include "voice_core.h"
#include "weather_core.h"
#include <Arduino.h>
#include <LiquidCrystal.h>
#include <OpenHuli.h>
#include <Preferences.h>
#include <cstdio>
#include <cstring>
#include <driver/rmt.h>
#include <new>
namespace openhuli::weather {
namespace {
constexpr uint32_t sample_interval = 60000;
constexpr size_t lcd_characters = 32;
TaskHandle_t worker_handle = nullptr;
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
alignas(LiquidCrystal) uint8_t lcd_storage[sizeof(LiquidCrystal)];
LiquidCrystal* lcd = nullptr;
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
  static OpenHuliClient client;
  ClientConfig settings;
  settings.device_id = config::device_id;
  settings.mqtt_host = config::mqtt_host;
  settings.mqtt_port = config::mqtt_port;
  settings.mqtt_username = config::mqtt_username;
  settings.mqtt_client_id = config::mqtt_client_id;
  settings.mqtt_token = config::device_mqtt_token;
  settings.root_ca = config::mqtt_root_ca;
  settings.firmware_version = "weather-reference-v1";
  settings.capabilities.microphone = config::voice_enabled;
  settings.capabilities.display_characters = lcd ? lcd_characters : 0;
  settings.display = lcd ? display_write : nullptr;
  settings.reserve = reserve_effect;
  settings.previous_boot_until = journal_ready ? reserved_until : 0;
  if (!client.begin(settings)) {
    Serial.println("weather client configuration or allocation failed");
    vTaskDelete(nullptr);
    return;
  }
  const bool sensor_ready = init_sensor();
  uint32_t sampled_tick = millis() - sample_interval + 2000, diagnostic_at = 0;
  for (;;) {
    client.loop();
    const uint32_t tick = millis();
    if (uint32_t(tick - sampled_tick) >= sample_interval) {
      sampled_tick = tick;
      const auto reading = sensor_ready ? sample_sensor() : Reading{};
      const int64_t sampled_at = client.now();
      Serial.printf("weather sensor=%s\n", reading.valid ? "measured" : "read_failed");
      if (lcd) {
        char label[33];
        if (reading.valid)
          std::snprintf(label, sizeof(label), "Temp %4.1f C     Hum  %4.1f %%",
                        double(reading.temperature), double(reading.humidity));
        else
          std::snprintf(label, sizeof(label), "Sensor read error");
        display_write(label);
      }
      // No sample queue or timestamp rewriting: unavailable network drops this sample.
      client.publish(reading, sampled_at);
    }
    if (uint32_t(tick - diagnostic_at) >= 10000) {
      diagnostic_at = tick;
      Serial.printf("weather online=%u stack=%u heap=%u\n", unsigned(client.connected()),
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
  return xTaskCreate(worker, "weather", 12288, nullptr, 1, &worker_handle) == pdPASS;
}
} // namespace openhuli::weather
