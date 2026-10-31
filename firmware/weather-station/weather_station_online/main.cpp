#include <Arduino.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <LiquidCrystal.h>
#include <OpenHuli.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include "settings.h"
#include "station_huli.h"
#include "weather_json.h"
#if __has_include("config.local.h") && !defined(OPENHULI_LINK_CHECK)
#include "config.local.h"
#else
#include "config.example.h"
#endif
#if __has_include("wifi_config.h") && !defined(OPENHULI_LINK_CHECK)
#include "wifi_config.h"
#else
#include "wifi_config.example.h"
#endif

#if !defined(CONFIG_IDF_TARGET_ESP32S2)
#error "Select the LOLIN S2 Mini / ESP32-S2 board for this pin map."
#endif
#if !defined(ARDUINO_USB_CDC_ON_BOOT) || ARDUINO_USB_CDC_ON_BOOT != 1
#error "Enable USB CDC On Boot: UART RX on GPIO37 would conflict with the DHT11."
#endif
#if defined(ARDUINO_USB_MODE) && ARDUINO_USB_MODE != 0
#error "ESP32-S2 logging requires native USB-OTG / TinyUSB mode."
#endif

extern const char rootCa[] asm("_binary_certs_root_ca_pem_start");
LiquidCrystal lcd(settings::kLcdRs, settings::kLcdEnable, settings::kLcdD4, settings::kLcdD5,
                  settings::kLcdD6, settings::kLcdD7);
DHT dht(settings::kDhtData, DHT11);

namespace {
struct FetchResult {
  online::Weather weather;
  bool ok = false;
  uint32_t retryAfter = 0;
  char error[64] = {};
};
QueueHandle_t requests = nullptr, results = nullptr;
bool workerReady = false, inFlight = false, ntpStarted = false, clockSynced = false;
bool roomValid = false;
float roomTemperature = 0, roomHumidity = 0;
uint32_t lastSensor = 0, lastWifiAttempt = 0, lastDisplay = 0;
uint32_t lastStatus = 0;
online::Cache cache;
online::RetrySchedule schedule;
online::Screen previousScreen;
char lastError[64] = {};
openhuli::OpenHuliClient huli;
station::Publisher publisher;
station::DisplayMessage message;
Preferences journal;
int64_t reservedUntil = 0;
bool huliReady = false, journalReady = false;

bool reserveEffect(int64_t until) {
  if (!journalReady)
    return false;
  if (until <= reservedUntil)
    return true;
  if (journal.putULong64("until", uint64_t(until)) != sizeof(uint64_t))
    return false;
  reservedUntil = until;
  return true;
}

void show(const online::Screen& next);
openhuli::device::Outcome displayMessage(const char* text) {
  if (!message.set(text, millis()))
    return openhuli::device::Outcome::unsupported;
  show(message.screen());
  // A write-only LCD confirms the GPIO sequence, not visible pixels.
  return openhuli::device::Outcome::succeeded;
}

void beginHuli() {
  if (!huli_config::enabled)
    return;
  openhuli::ClientConfig config;
  config.device_id = huli_config::device_id;
  config.mqtt_host = huli_config::mqtt_host;
  config.mqtt_port = huli_config::mqtt_port;
  config.mqtt_username = huli_config::mqtt_username;
  config.mqtt_client_id = huli_config::mqtt_client_id;
  config.mqtt_token = huli_config::mqtt_token;
  config.root_ca = huli_config::root_ca;
  config.firmware_version = "weather-station-v1";
  config.capabilities.display_characters = 32;
  config.display = displayMessage;
  config.reserve = reserveEffect;
  if (!openhuli::valid_config(config)) {
    Serial.println("OpenHuli: incomplete MQTT identity/CA; continuing locally.");
    return;
  }
  journalReady = journal.begin("openhuli_cmd", false);
  if (journalReady) {
    // A wrong-type or invalid stored value fails closed; never erase the fence automatically.
    reservedUntil = int64_t(journal.getULong64("until", UINT64_MAX));
    if (!journal.isKey("until")) {
      journalReady = journal.putULong64("until", 0) == sizeof(uint64_t);
      reservedUntil = 0;
    }
    journalReady = journalReady && reservedUntil >= 0 && reservedUntil < 4102444800000LL;
  }
  if (!journalReady) {
    Serial.println("OpenHuli: command journal unavailable; continuing locally.");
    return;
  }
  config.previous_boot_until = reservedUntil;
  huliReady = huli.begin(config);
  Serial.println(huliReady ? "OpenHuli: configured, waiting for MQTT TLS."
                           : "OpenHuli: client unavailable; continuing locally.");
}

uint64_t uptimeMs() { return uint64_t(esp_timer_get_time()) / 1000; }
bool configured() { return wifi_config::kSsid[0] != '\0'; }

// HTTP/1.0 requests identity transfer. Read at most 4 KiB, with an overall
// body deadline in addition to the connection, TLS and socket timeouts.
bool readBody(HTTPClient& http, char* body, size_t& length) {
  const int expected = http.getSize();
  if (expected > int(settings::kMaxResponseBytes) || http.header("Transfer-Encoding").length() != 0)
    return false;
  WiFiClient* stream = http.getStreamPtr();
  const uint32_t started = millis();
  length = 0;
  while (uint32_t(millis() - started) < settings::kReadTimeoutMs) {
    while (stream->available() > 0) {
      if (length >= settings::kMaxResponseBytes)
        return false;
      const int byte = stream->read();
      if (byte < 0)
        break;
      body[length++] = char(byte);
      if (expected >= 0 && length == size_t(expected)) {
        body[length] = '\0';
        return length != 0;
      }
      if (uint32_t(millis() - started) >= settings::kReadTimeoutMs)
        return false;
    }
    if (!http.connected()) {
      body[length] = '\0';
      return length != 0 && (expected < 0 || length == size_t(expected));
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  return false;
}

FetchResult fetchWeather() {
  FetchResult result;
  WiFiClientSecure tls;
  tls.setCACert(rootCa);
  tls.setHandshakeTimeout(settings::kTlsTimeoutSeconds);
  HTTPClient http;
  http.useHTTP10(true);
  http.setConnectTimeout(settings::kConnectTimeoutMs);
  http.setTimeout(settings::kReadTimeoutMs);
  const char* headers[] = {"Transfer-Encoding", "Retry-After"};
  http.collectHeaders(headers, 2);
  if (!http.begin(tls, settings::kApiUrl)) {
    snprintf(result.error, sizeof(result.error), "HTTPS setup failed");
    return result;
  }
  const int status = http.GET();
  if (status != HTTP_CODE_OK) {
    snprintf(result.error, sizeof(result.error), "Weather HTTP %d", status);
    if (status == 429 || status == 503) {
      // Numeric Retry-After is honored. HTTP-date/unrecognized values use 15 min.
      result.retryAfter = 900;
      const String retry = http.header("Retry-After");
      char* end = nullptr;
      const unsigned long seconds = strtoul(retry.c_str(), &end, 10);
      if (retry.length() && end != retry.c_str() && *end == '\0' && retry[0] != '-' &&
          seconds > 0 && seconds <= UINT32_MAX)
        result.retryAfter = uint32_t(seconds);
    }
  } else {
    char body[settings::kMaxResponseBytes + 1];
    size_t length = 0;
    if (!readBody(http, body, length))
      snprintf(result.error, sizeof(result.error), "Weather body invalid/timeout");
    else if (!online::parseWeather(body, length, int64_t(time(nullptr)), result.weather))
      snprintf(result.error, sizeof(result.error), "Weather JSON invalid/stale");
    else
      result.ok = true;
  }
  http.end();
  return result;
}

void weatherWorker(void*) {
  uint8_t request;
  for (;;) {
    if (xQueueReceive(requests, &request, portMAX_DELAY) == pdTRUE) {
      const FetchResult result = fetchWeather();
      xQueueOverwrite(results, &result);
    }
  }
}

void show(const online::Screen& next) {
  for (uint8_t row = 0; row < 2; ++row) {
    if (memcmp(previousScreen.rows[row], next.rows[row], 16) != 0) {
      lcd.setCursor(0, row);
      lcd.print(next.rows[row]);
      memcpy(previousScreen.rows[row], next.rows[row], 17);
    }
  }
}

const char* networkStatus() {
  if (!configured())
    return "Set Wi-Fi config";
  if (WiFi.status() != WL_CONNECTED)
    return "Wi-Fi offline";
  if (!clockSynced)
    return "Syncing time...";
  if (!workerReady)
    return "Weather task err";
  if (inFlight)
    return "Fetching weather";
  if (lastError[0])
    return "Weather error";
  return "No weather yet";
}

void updateNetwork(uint32_t now, uint64_t uptime) {
  if (configured() && WiFi.status() != WL_CONNECTED &&
      uint32_t(now - lastWifiAttempt) >= settings::kWifiRetryMs) {
    lastWifiAttempt = now;
    WiFi.disconnect();
    WiFi.begin(wifi_config::kSsid, wifi_config::kPassword);
  }
  if (WiFi.status() == WL_CONNECTED && !ntpStarted) {
    configTzTime(settings::kTimezone, "pool.ntp.org", "time.nist.gov");
    ntpStarted = true;
  }
  if (ntpStarted && sntp_get_sync_status() == SNTP_SYNC_STATUS_COMPLETED &&
      time(nullptr) >= 1704067200)
    clockSynced = true;

  FetchResult result;
  if (results && xQueueReceive(results, &result, 0) == pdTRUE) {
    inFlight = false;
    if (result.ok) {
      cache.accept(result.weather, uptime);
      schedule.success(uptime);
      lastError[0] = '\0';
      if (Serial)
        Serial.printf("Berlin: %.1f C, %.0f%% RH; source open-meteo.com\n",
                      double(result.weather.temperature), double(result.weather.humidity));
    } else {
      schedule.failure(uptime, result.retryAfter);
      snprintf(lastError, sizeof(lastError), "%s", result.error);
      if (Serial)
        Serial.println(lastError);
    }
  }
  if (workerReady && configured() && WiFi.status() == WL_CONNECTED && clockSynced && !inFlight &&
      schedule.due(uptime)) {
    const uint8_t request = 1;
    inFlight = xQueueSend(requests, &request, 0) == pdTRUE;
  }
}
} // namespace

void setup() {
  Serial.begin(115200); // No wait: USB power alone is sufficient.
  lcd.begin(16, 2);
  dht.begin();
  setenv("TZ", settings::kTimezone, 1);
  tzset();
  lastSensor = millis();
  requests = xQueueCreate(1, sizeof(uint8_t));
  results = xQueueCreate(1, sizeof(FetchResult));
  if (requests && results)
    workerReady = xTaskCreate(weatherWorker, "weather", 24576, nullptr, 1, nullptr) == pdPASS;
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (configured())
    WiFi.begin(wifi_config::kSsid, wifi_config::kPassword);
  beginHuli();
  lastWifiAttempt = millis();
  if (Serial)
    Serial.println("Berlin weather station; source https://open-meteo.com/ (CC BY 4.0)");
}

void loop() {
  const uint32_t now = millis();
  const uint64_t uptime = uptimeMs();
  updateNetwork(now, uptime);
  if (huliReady)
    huli.loop();
  if (uint32_t(now - lastSensor) >= settings::kSensorIntervalMs) {
    roomHumidity = dht.readHumidity();
    roomTemperature = dht.readTemperature();
    lastSensor = millis();
    roomValid = station::roomReading(roomTemperature, roomHumidity).valid;
    if (huliReady)
      publisher.sample(huli, lastSensor, roomTemperature, roomHumidity);
    if (!roomValid && Serial)
      Serial.println("DHT11 ERROR: check labels, GPIO37, 3V3, GND and DATA pull-up.");
  }
  if (uint32_t(now - lastDisplay) >= settings::kDisplayIntervalMs) {
    lastDisplay = now;
    online::Screen next;
    if (uptime < 4000) {
      snprintf(next.rows[0], 17, "%s", uptime < 2000 ? "Weather Station" : "Weather source");
      snprintf(next.rows[1], 17, "%s", uptime < 2000 ? "Starting..." : "open-meteo.com");
      online::pad(next.rows[0]);
      online::pad(next.rows[1]);
    } else {
      char clockRow[17] = {};
      const time_t utc = time(nullptr);
      tm local = {};
      if (clockSynced && localtime_r(&utc, &local))
        strftime(clockRow, sizeof(clockRow), "%d/%m/%Y %H:%M", &local);
      else
        snprintf(clockRow, sizeof(clockRow), "%s", networkStatus());
      const uint64_t elapsed = uptime - 4000;
      const unsigned page = (elapsed / settings::kPageMs) % 3;
      const bool credit = elapsed % settings::kPageMs >= settings::kPageMs / 2;
      next = online::screen(page, roomValid, roomTemperature, roomHumidity, clockRow, cache, uptime,
                            int64_t(utc), networkStatus(), credit);
    }
    show(message.active(millis()) ? message.screen() : next);
  }
  // USB diagnostics expose state without printing Wi-Fi credentials. Also
  // accept '?' so an attached monitor can inspect a station already running.
  bool statusRequested = false;
  while (Serial.available() > 0) {
    if (Serial.read() == '?')
      statusRequested = true;
  }
  if (Serial && (statusRequested || uint32_t(now - lastStatus) >= 10000)) {
    lastStatus = now;
    Serial.printf("OpenHuli: %s\n", !huliReady         ? "local mode"
                                    : huli.connected() ? "online"
                                                       : "offline");
    Serial.printf("Status: Wi-Fi=%s (%d), clock=%s, weather=%s, DHT11=%s\n",
                  WiFi.status() == WL_CONNECTED ? "connected" : "offline", int(WiFi.status()),
                  clockSynced ? "synced" : "waiting", cache.hasData ? "cached" : networkStatus(),
                  roomValid ? "OK" : "ERROR");
    if (roomValid)
      Serial.printf("Room: %.1f C, %.0f%% RH\n", double(roomTemperature), double(roomHumidity));
    Serial.printf("LCD intended: [%s] [%s]\n", previousScreen.rows[0], previousScreen.rows[1]);
  }
  delay(5);
}
