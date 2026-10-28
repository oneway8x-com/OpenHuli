#include <Arduino.h>
#include <OpenHuli.h>
#include <WiFi.h>
#if __has_include("config.local.h") && !defined(OPENHULI_LINK_CHECK)
#include "config.local.h"
#else
#include "config.example.h"
#endif

openhuli::OpenHuliClient huli;
uint32_t sampled_tick = 0, wifi_retry = 0;
bool configured = false;

// Replace this function with YOUR sensor driver. Timestamp after reading, before publishing.
// A missing/failed sensor reports errors; this example never invents measurements.
openhuli::device::Telemetry readSensors() {
  using namespace openhuli::device;
  Telemetry sample;
  sample.temperature = {SensorStatus::unavailable, 0};
  sample.humidity = {SensorStatus::unavailable, 0};
  // For a real successful reading: sample.temperature = {SensorStatus::measured, measuredCelsius};
  return sample;
}
void setup() {
  Serial.begin(115200);
  openhuli::ClientConfig config;
  config.device_id = DEVICE_ID;
  config.mqtt_host = MQTT_HOST;
  config.mqtt_port = MQTT_PORT;
  config.mqtt_username = MQTT_USERNAME;
  config.mqtt_client_id = MQTT_CLIENT_ID;
  config.mqtt_token = MQTT_TOKEN;
  config.root_ca = ROOT_CA;
  configured = *WIFI_SSID && huli.begin(config);
  if (!configured) {
    Serial.println("Configure Wi-Fi and the provisioned OpenHuli MQTT identity and CA first.");
    return;
  }
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // Use a trusted local time source for your deployment. TLS/commands wait for sane UTC.
  configTime(0, 0, "pool.ntp.org");
  sampled_tick = millis() - 30000;
}
void loop() {
  if (!configured) {
    delay(100);
    return;
  }
  huli.loop(); // Called from this task; callbacks must not re-enter the client.
  const uint32_t tick = millis();
  if (WiFi.status() != WL_CONNECTED && uint32_t(tick - wifi_retry) >= 30000) {
    wifi_retry = tick;
    WiFi.reconnect();
  }
  if (huli.connected() && uint32_t(tick - sampled_tick) >= 30000) {
    sampled_tick = tick;
    const auto sample = readSensors();
    if (!huli.publish(sample, huli.now()))
      Serial.println("Sample was not sent.");
  }
  delay(10);
}
