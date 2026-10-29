#include <Arduino.h>
#include <DHT.h>
#include <LiquidCrystal.h>
#include <WiFi.h>
#include <esp_sntp.h>
#include <time.h>

#include "clock_display.h"
#include "config.h"
#include "readout.h"
#if __has_include("wifi_config.h")
#include "wifi_config.h"
#else
#include "wifi_config.example.h"
#endif

namespace {
LiquidCrystal lcd(config::kLcdRs, config::kLcdEnable, config::kLcdD4, config::kLcdD5,
                  config::kLcdD6, config::kLcdD7);
DHT sensor(config::kDhtData, DHT11);
weather::Readout readout(0, config::kSensorWarmupMs, config::kSampleIntervalMs);
weather::Frame previousFrame;
uint32_t lastWifiAttempt = 0;
uint32_t lastDisplayUpdate = 0;
bool ntpStarted = false;
bool clockSynced = false;
bool connectionTimedOut = false;

void connectWifi() {
  lastWifiAttempt = millis();
  WiFi.begin(wifi_config::kSsid, wifi_config::kPassword);
}

void maintainClock(uint32_t now) {
  if (wifi_config::kSsid[0] == '\0')
    return;
  if (WiFi.status() == WL_CONNECTED) {
    if (!ntpStarted) {
      configTzTime(config::kTimezone, config::kNtpServer1, config::kNtpServer2);
      ntpStarted = true;
    }
  } else if (uint32_t(now - lastWifiAttempt) >= config::kWifiRetryMs) {
    connectionTimedOut = true;
    WiFi.disconnect();
    connectWifi();
  }
  if (ntpStarted && !clockSynced && sntp_get_sync_status() == SNTP_SYNC_STATUS_COMPLETED) {
    clockSynced = true;
    if (Serial)
      Serial.println("Clock synchronized; Europe/Berlin time enabled.");
  }
}

void refreshDisplay() {
  tm localTime = {};
  weather::ClockStatus status = weather::ClockStatus::Unconfigured;
  if (clockSynced && getLocalTime(&localTime, 0)) {
    status = weather::ClockStatus::Ready;
  } else if (wifi_config::kSsid[0] != '\0') {
    status = WiFi.status() == WL_CONNECTED ? weather::ClockStatus::Syncing
             : connectionTimedOut          ? weather::ClockStatus::Offline
                                           : weather::ClockStatus::Connecting;
  }
  char clockRow[17];
  weather::clockLine(clockRow, status, &localTime);
  const weather::Frame next = readout.frame(clockRow);
  for (uint8_t row = 0; row < 2; ++row) {
    if (memcmp(previousFrame.rows[row], next.rows[row], 16) != 0) {
      lcd.setCursor(0, row);
      lcd.print(next.rows[row]);
      memcpy(previousFrame.rows[row], next.rows[row], 17);
    }
  }
}
} // namespace

void setup() {
  Serial.begin(115200);
  // Battery operation must not wait for a computer's serial connection.
  sensor.begin();
  readout = weather::Readout(millis(), config::kSensorWarmupMs, config::kSampleIntervalMs);
  lcd.begin(16, 2);
  if (wifi_config::kSsid[0] != '\0') {
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    connectWifi();
  }
  refreshDisplay();
}

void loop() {
  const uint32_t now = millis();
  maintainClock(now);
  if (uint32_t(now - lastDisplayUpdate) >= config::kDisplayRefreshMs) {
    lastDisplayUpdate = now;
    refreshDisplay();
  }
  if (readout.due(millis())) {
    // The library caches the transaction, so these are a paired sample.
    const float humidity = sensor.readHumidity();
    const float temperature = sensor.readTemperature();
    const uint32_t sampledAt = millis();
    readout.record(sampledAt, temperature, humidity);
    refreshDisplay();

    if (Serial) {
      if (readout.status() == weather::Status::Ready) {
        Serial.printf("[%lu ms] Temperature: %.1f C; humidity: %.1f %% RH\n",
                      static_cast<unsigned long>(sampledAt), double(temperature), double(humidity));
      } else {
        Serial.printf("[%lu ms] DHT11 read failed; check DATA on GPIO%u, "
                      "3.3 V supply and common GND. Retrying.\n",
                      static_cast<unsigned long>(sampledAt), config::kDhtData);
      }
    }
  }
  delay(5);
}
