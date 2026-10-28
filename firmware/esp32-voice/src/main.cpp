#include "voice_core.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <driver/gpio.h>
#include <driver/i2s.h>
#include <esp_heap_caps.h>
#if __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif
#if !defined(CONFIG_IDF_TARGET_ESP32S2)
#error This unvalidated reference target is ESP32-S2 only.
#endif

using openhuli::State;
namespace {
constexpr uint32_t capture_timeout_ms = 30000;
constexpr size_t queue_capacity = 6; // 120ms of audio; overflow cancels the whole turn.
struct Chunk {
  uint32_t generation;
  bool end;
  uint8_t pcm[openhuli::pcm_bytes];
};
WebSocketsClient socket;
openhuli::VoiceCore voice;
openhuli::ControlBuffer controls;
openhuli::MessageHistory messages;
openhuli::Button button;
StaticJsonDocument<1536> document;
StaticQueue_t queue_storage;
uint8_t queue_bytes[queue_capacity * sizeof(Chunk)];
QueueHandle_t queue = nullptr;
TaskHandle_t capture_handle = nullptr;
std::atomic<uint32_t> generation{0};
std::atomic<bool> capture{false}, finish_capture{false}, capture_fault{false};
bool configured = false, socket_started = false, clock_started = false, cancel_held = false;
uint32_t turn_started = 0, phase_started = 0, cancel_started = 0, diagnostic_at = 0,
         wifi_attempt_at = 0;
uint32_t error_indicator_at = 0;
uint32_t retry_ms = 1000, message_sequence = 0, max_queue_used = 0;
char session_hint[32], turn_id[64], message_id[64], authorization[2060];
uint8_t wire[openhuli::frame_bytes];
const char* state_name() {
  switch (voice.state) {
  case State::offline:
    return "offline";
  case State::negotiating:
    return "negotiating";
  case State::ready:
    return "ready";
  case State::recording:
    return "recording";
  case State::draining:
    return "draining";
  case State::waiting:
    return "waiting";
  case State::fault:
    return "fault";
  }
  return "fault";
}
void clear_capture() {
  capture.store(false);
  finish_capture.store(false);
  generation.fetch_add(1);
  if (queue)
    xQueueReset(queue);
}
void invalidate() {
  clear_capture();
  controls.clear();
  messages.clear();
  voice.disconnected();
  cancel_held = false;
}
void fault(const char* safe_reason) {
  error_indicator_at = millis();
  clear_capture();
  voice.fail();
  Serial.printf("voice fault: %s\n", safe_reason);
  socket.disconnect();
}
bool send_control(openhuli::Control kind) {
  std::snprintf(message_id, sizeof(message_id), "%s-m%lu", session_hint,
                static_cast<unsigned long>(++message_sequence));
  char text[512];
  if (!openhuli::write_control(text, sizeof(text), kind, message_id,
                               kind == openhuli::Control::session ? session_hint : turn_id,
                               voice.turn, voice.turn, voice.sent ? voice.sent - 1 : 0))
    return false;
  return socket.sendTXT(text);
}
void cancel_turn() {
  clear_capture();
  if (voice.cancel() && !send_control(openhuli::Control::cancel))
    socket.disconnect();
  cancel_held = false;
}
bool format_matches(JsonVariantConst value) {
  JsonObjectConst format = value.as<JsonObjectConst>();
  return format.size() == 4 && format["encoding"] == "pcm_s16le" &&
         format["sampleRateHz"].is<unsigned>() && format["sampleRateHz"].as<unsigned>() == 16000 &&
         format["channels"].is<unsigned>() && format["channels"].as<unsigned>() == 1 &&
         format["chunkDurationMs"].is<unsigned>() && format["chunkDurationMs"].as<unsigned>() == 20;
}
void receive_control() {
  document.clear();
  // Mutable bounded input allows zero-copy string parsing; do not retain pointers past this
  // callback.
  if (deserializeJson(document, controls.data(), controls.size(),
                      DeserializationOption::NestingLimit(6))) {
    fault("invalid control");
    return;
  }
  JsonObjectConst value = document.as<JsonObjectConst>();
  const char* type = value["type"];
  if (!value["version"].is<unsigned>() || value["version"].as<unsigned>() != 1 || !type ||
      !messages.accept(value["messageId"].as<const char*>())) {
    fault("invalid control identity");
    return;
  }
  if (!std::strcmp(type, "session.error")) {
    fault("server rejected session");
    return;
  }
  if (!std::strcmp(type, "session.ready")) {
    if (value.size() != 5 || !openhuli::valid_id(value["sessionId"]) ||
        !format_matches(value["inputFormat"]) || !voice.ready()) {
      fault("unsupported negotiation");
      return;
    }
    retry_ms = 1000;
    phase_started = millis();
    Serial.println("voice ready");
    return;
  }
  const char* received_turn = value["turnId"];
  if (!openhuli::valid_id(received_turn)) {
    fault("missing turn identity");
    return;
  }
  // A response can race a local cancel. An older turn may be discarded, never applied to the
  // current turn.
  if (std::strcmp(received_turn, turn_id) || voice.state == State::ready)
    return;
  if (!std::strcmp(type, "response.text")) {
    const char* text = value["text"];
    if (value.size() != 5 || !text || !*text || !voice.response()) {
      fault("invalid response order");
      return;
    }
    Serial.println("voice response received");
    if (config::show_response_text)
      Serial.println(text);
  } else if (!std::strcmp(type, "turn.completed")) {
    if (value.size() != 4 || !voice.completed()) {
      fault("incomplete response");
      return;
    }
    Serial.println("voice turn completed");
  } else if (!std::strcmp(type, "turn.failed")) {
    if (value.size() != 5) {
      fault("invalid failure");
      return;
    }
    clear_capture();
    voice.cancel();
    Serial.println("voice turn failed");
  } else {
    fault("unexpected response type");
  }
}
void websocket_event(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
  case WStype_CONNECTED:
    invalidate();
    voice.connected();
    message_sequence = 0;
    std::snprintf(session_hint, sizeof(session_hint), "s2-%08lx-%08lx",
                  static_cast<unsigned long>(esp_random()),
                  static_cast<unsigned long>(esp_random()));
    turn_id[0] = '\0';
    phase_started = millis();
    if (!send_control(openhuli::Control::session))
      fault("session send failed");
    break;
  case WStype_DISCONNECTED:
    invalidate();
    retry_ms = retry_ms < 15000 ? retry_ms * 2 : 30000;
    socket.setReconnectInterval(retry_ms + esp_random() % 251);
    break;
  case WStype_ERROR:
    fault("transport error");
    break;
  case WStype_TEXT:
  case WStype_FRAGMENT_TEXT_START:
  case WStype_FRAGMENT:
  case WStype_FRAGMENT_FIN: {
    const bool start = type == WStype_TEXT || type == WStype_FRAGMENT_TEXT_START;
    const bool final = type == WStype_TEXT || type == WStype_FRAGMENT_FIN;
    const auto result = controls.push(payload, length, start, final);
    if (result == openhuli::FragmentResult::rejected)
      fault("control exceeds bounds or fragment order");
    else if (result == openhuli::FragmentResult::complete)
      receive_control();
    break;
  }
  case WStype_BIN:
  case WStype_FRAGMENT_BIN_START:
    fault("speaker output was not negotiated");
    break;
  default:
    break; // Ping/pong is owned by the transport.
  }
}
void capture_task(void*) {
  int32_t samples[openhuli::samples_per_chunk];
  Chunk chunk{};
  for (;;) {
    const bool recording = capture.load();
    const uint32_t epoch = generation.load();
    size_t bytes = 0;
    const auto result = i2s_read(I2S_NUM_0, samples, sizeof(samples), &bytes, pdMS_TO_TICKS(25));
    if (result != ESP_OK || !bytes || bytes % sizeof(int32_t) ||
        (bytes != sizeof(samples) && !finish_capture.load())) {
      if (recording && capture.load() && epoch == generation.load()) {
        capture_fault.store(true);
        capture.store(false);
      }
      // A failed peripheral can return immediately. Yield so the network task can cancel/close.
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }
    if (!recording || !capture.load() || epoch != generation.load())
      continue;
    chunk.generation = epoch;
    chunk.end = false;
    openhuli::convert_pcm(samples, bytes / sizeof(int32_t), config::sample_shift, chunk.pcm);
    if (xQueueSend(queue, &chunk, 0) != pdTRUE) {
      capture_fault.store(true);
      capture.store(false);
      continue;
    }
    if (finish_capture.load()) {
      chunk.end = true;
      if (xQueueSend(queue, &chunk, 0) != pdTRUE)
        capture_fault.store(true);
      capture.store(false);
    }
  }
}
bool start_microphone() {
  i2s_config_t settings{};
  settings.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX);
  settings.sample_rate = 16000;
  settings.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  settings.channel_format =
      config::microphone_left_slot ? I2S_CHANNEL_FMT_ONLY_LEFT : I2S_CHANNEL_FMT_ONLY_RIGHT;
  settings.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  settings.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  settings.dma_buf_count = 4;
  settings.dma_buf_len = openhuli::samples_per_chunk;
  i2s_pin_config_t pins{};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = config::mic_bclk;
  pins.ws_io_num = config::mic_ws;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = config::mic_data;
  if (i2s_driver_install(I2S_NUM_0, &settings, 0, nullptr) != ESP_OK)
    return false;
  if (i2s_set_pin(I2S_NUM_0, &pins) != ESP_OK) {
    i2s_driver_uninstall(I2S_NUM_0);
    return false;
  }
  if (xTaskCreate(capture_task, "mic", 4096, nullptr, 3, &capture_handle) == pdPASS)
    return true;
  i2s_driver_uninstall(I2S_NUM_0);
  return false;
}
bool safe_pin(int pin, bool output) {
  // Exclude USB, flash/PSRAM, BOOT and strapping pins; this is validation, not a proposed pin map.
  return ((pin >= 1 && pin <= 18) || pin == 21 || (pin >= 33 && pin <= 44)) &&
         (output ? GPIO_IS_VALID_OUTPUT_GPIO(pin) : GPIO_IS_VALID_GPIO(pin));
}
bool validate_config() {
  if (!config::hardware_confirmed || !safe_pin(config::mic_bclk, true) ||
      !safe_pin(config::mic_ws, true) || !safe_pin(config::mic_data, false) ||
      !safe_pin(config::button, false) || (config::led != -1 && !safe_pin(config::led, true)) ||
      config::sample_shift > 24 || config::sample_shift < 8)
    return false;
  const int pins[] = {config::mic_bclk, config::mic_ws, config::mic_data, config::button,
                      config::led};
  for (size_t i = 0; i < 5; ++i)
    for (size_t j = i + 1; j < 5; ++j)
      if (pins[i] >= 0 && pins[i] == pins[j])
        return false;
  if (!*config::wifi_ssid || std::strlen(config::wifi_ssid) > 32 || config::voice_port == 0 ||
      config::voice_port > 65535 || std::strncmp(config::device_voice_token, "ohd1.", 5) ||
      std::strlen(config::device_voice_token) > 2048 ||
      !std::strstr(config::root_ca, "-----BEGIN CERTIFICATE-----"))
    return false;
  for (const char* c = config::device_voice_token; *c; ++c)
    if (!(std::isalnum(static_cast<unsigned char>(*c)) || *c == '.' || *c == '_' || *c == '-'))
      return false;
  const size_t host_length = std::strlen(config::voice_host);
  if (!host_length || host_length > 253)
    return false;
  for (const char* c = config::voice_host; *c; ++c)
    if (!(std::isalnum(static_cast<unsigned char>(*c)) || *c == '.' || *c == '-'))
      return false;
  return true;
}
void begin_turn() {
  if (!voice.start()) {
    socket.disconnect();
    return;
  }
  clear_capture();
  capture_fault.store(false);
  std::snprintf(turn_id, sizeof(turn_id), "%s-t%lu", session_hint,
                static_cast<unsigned long>(voice.turn));
  if (!send_control(openhuli::Control::start)) {
    fault("turn start failed");
    return;
  }
  turn_started = millis();
  finish_capture.store(false);
  capture.store(true);
  Serial.println("voice recording");
}
void input_and_send(uint32_t now) {
  const bool edge = button.update(digitalRead(config::button) == LOW, now);
  if (edge && button.down() && voice.state == State::ready)
    begin_turn();
  else if (edge && !button.down() && voice.state == State::recording) {
    voice.release();
    finish_capture.store(true);
    phase_started = now;
  } else if (edge && button.down() && voice.state == State::waiting) {
    cancel_held = true;
    cancel_started = now;
  }
  if (!button.down())
    cancel_held = false;
  if (cancel_held && uint32_t(now - cancel_started) >= 1000)
    cancel_turn();
  if ((voice.state == State::recording || voice.state == State::draining) &&
      uint32_t(now - turn_started) >= capture_timeout_ms) {
    cancel_turn();
    Serial.println("voice recording limit; cancelled");
  }
  if (capture_fault.exchange(false)) {
    fault("microphone or audio queue failure; not committed");
    return;
  }
  const uint32_t used = uxQueueMessagesWaiting(queue);
  if (used > max_queue_used)
    max_queue_used = used;
  Chunk chunk{};
  if (xQueueReceive(queue, &chunk, 0) == pdTRUE && chunk.generation == generation.load()) {
    if (voice.state != State::recording && voice.state != State::draining)
      return;
    if (chunk.end) {
      if (!voice.commit() || !send_control(openhuli::Control::commit)) {
        fault("commit failed");
        return;
      }
      phase_started = now;
      Serial.println("voice waiting");
    } else {
      if (voice.sent >= openhuli::max_chunks) {
        cancel_turn();
        return;
      }
      openhuli::encode_frame(wire, voice.turn, voice.turn, voice.sent, chunk.pcm);
      if (!socket.sendBIN(wire, sizeof(wire)) || !voice.frame_sent())
        fault("audio send failed; not committed");
    }
  }
  if (Serial.available()) {
    const int command = Serial.read();
    if (command == 'c' || command == 'C')
      cancel_turn();
  }
}
void indicator(uint32_t now) {
  if (config::led < 0)
    return;
  bool on = false;
  const State visible =
      error_indicator_at && uint32_t(now - error_indicator_at) < 3000 ? State::fault : voice.state;
  switch (visible) {
  case State::recording:
    on = true;
    break;
  case State::draining:
  case State::waiting:
    on = now % 500 < 250;
    break;
  case State::fault:
    on = now % 100 < 50;
    break;
  case State::offline:
  case State::negotiating:
    on = now % 2000 < 100;
    break;
  case State::ready:
    break;
  }
  digitalWrite(config::led, on == config::led_active_high ? HIGH : LOW);
}
} // namespace
void setup() {
  Serial.begin(115200);
  configured = validate_config();
  if (!configured) {
    voice.fail();
    Serial.println(
        "Unconfigured reference: confirm hardware and private config.local.h before use");
    return;
  }
  queue = xQueueCreateStatic(queue_capacity, sizeof(Chunk), queue_bytes, &queue_storage);
  pinMode(config::button, INPUT_PULLUP);
  button.initialize(digitalRead(config::button) == LOW, millis());
  if (config::led >= 0)
    pinMode(config::led, OUTPUT);
  if (!queue || !start_microphone()) {
    configured = false;
    voice.fail();
    Serial.println("Microphone setup failed");
    return;
  }
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(config::wifi_ssid, config::wifi_password);
  std::snprintf(authorization, sizeof(authorization), "Bearer %s", config::device_voice_token);
  socket.onEvent(websocket_event);
}
void loop() {
  if (!configured) {
    delay(100);
    return;
  }
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (voice.state != State::offline) {
      invalidate();
      socket.disconnect();
    }
    if (uint32_t(now - wifi_attempt_at) > 30000) {
      wifi_attempt_at = now;
      WiFi.reconnect();
    }
  } else {
    if (!clock_started) {
      configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
      clock_started = true;
    }
    if (std::time(nullptr) >= 1704067200) {
      if (!socket_started) {
        // CA chain and DNS hostname verification remain enabled. No plaintext/insecure mode exists.
        socket.beginSslWithCA(config::voice_host, config::voice_port, "/voice", config::root_ca,
                              "");
        socket.setExtraHeaders(
            nullptr); // Remove library default Origin:file://; native device auth is header-only.
        socket.setAuthorization(authorization);
        socket.setReconnectInterval(1000);
        socket.enableHeartbeat(15000, 3000, 2);
        socket_started = true;
      }
      socket.loop();
    }
  }
  input_and_send(now);
  if ((voice.state == State::negotiating && uint32_t(now - phase_started) > 5000) ||
      (voice.state == State::draining && uint32_t(now - phase_started) > 2000) ||
      (voice.state == State::waiting && uint32_t(now - phase_started) > 60000))
    fault("session phase deadline");
  indicator(now);
  if (uint32_t(now - diagnostic_at) >= 10000) {
    diagnostic_at = now;
    Serial.printf(
        "voice state=%s heap=%u minimum_heap=%u psram=%u capture_stack=%u queue_peak=%lu "
        "chunks=%lu\n",
        state_name(), ESP.getFreeHeap(), heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL),
        ESP.getPsramSize(), static_cast<unsigned>(uxTaskGetStackHighWaterMark(capture_handle)),
        static_cast<unsigned long>(max_queue_used), static_cast<unsigned long>(voice.sent));
  }
  delay(1);
}
