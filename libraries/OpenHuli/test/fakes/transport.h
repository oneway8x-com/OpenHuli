#pragma once
#include <cstdint>
#include <cstring>
#include <deque>
#include <string>
#include <vector>
using esp_event_base_t = const char*;
using Handler = void (*)(void*, esp_event_base_t, int32_t, void*);
constexpr int ESP_OK = 0, ESP_FAIL = -1, WL_CONNECTED = 3;
constexpr int MQTT_EVENT_ANY = -1, MQTT_EVENT_CONNECTED = 1, MQTT_EVENT_DISCONNECTED = 2,
              MQTT_EVENT_DATA = 3, MQTT_EVENT_SUBSCRIBED = 4;
constexpr int MQTT_TRANSPORT_OVER_SSL = 1, MQTT_PROTOCOL_V_3_1_1 = 4;
#define ESP_IDF_VERSION_MAJOR 4
struct esp_mqtt_event_t {
  int data_len = 0, total_data_len = 0, current_data_offset = 0, topic_len = 0, msg_id = 0;
  char *data = nullptr, *topic = nullptr;
  bool retain = false;
};
struct esp_mqtt_client_config_t {
  const char *host = nullptr, *cert_pem = nullptr, *client_id = nullptr, *username = nullptr,
             *password = nullptr, *lwt_topic = nullptr, *lwt_msg = nullptr;
  int port = 0, transport = 0, lwt_retain = 0, disable_clean_session = 0, keepalive = 0,
      task_prio = 0, task_stack = 0, buffer_size = 0, out_buffer_size = 0, network_timeout_ms = 0,
      protocol_ver = 0;
  bool skip_cert_common_name_check = false, disable_auto_reconnect = false;
};
struct FakeMqtt {
  Handler callback = nullptr;
  void* context = nullptr;
};
using esp_mqtt_client_handle_t = FakeMqtt*;
namespace fixture {
struct Publication {
  std::string topic, payload;
  bool retain;
  int qos;
};
extern uint64_t tick;
extern int64_t wall_offset;
extern bool network, auto_connect, auto_ack, fail_publish, fail_start, fail_reserve;
extern FakeMqtt* active;
extern esp_mqtt_client_config_t config;
extern std::string will;
extern std::vector<Publication> publications;
void event(int id);
void command(std::string text, bool retained = false,
             const char* topic = "openhuli/v1/devices/device-1/commands");
} // namespace fixture
struct FakeWifi {
  int status() { return fixture::network ? WL_CONNECTED : 0; }
};
extern FakeWifi WiFi;
inline int64_t esp_timer_get_time() { return int64_t(fixture::tick) * 1000; }
inline uint32_t esp_random() {
  static uint32_t sequence = 1;
  return sequence++;
}
esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t*);
int esp_mqtt_client_register_event(FakeMqtt*, int, Handler, void*);
int esp_mqtt_client_start(FakeMqtt*);
int esp_mqtt_client_stop(FakeMqtt*);
int esp_mqtt_client_destroy(FakeMqtt*);
int esp_mqtt_client_disconnect(FakeMqtt*);
int esp_mqtt_client_publish(FakeMqtt*, const char*, const char*, int, int, int);
int esp_mqtt_client_subscribe(FakeMqtt*, const char*, int);
struct FakeQueue {
  size_t capacity, size;
  std::deque<std::vector<char>> items;
};
using QueueHandle_t = FakeQueue*;
constexpr int pdTRUE = 1;
inline QueueHandle_t xQueueCreate(size_t count, size_t size) {
  return new FakeQueue{count, size, {}};
}
inline int xQueueReset(QueueHandle_t q) {
  q->items.clear();
  return 1;
}
inline void vQueueDelete(QueueHandle_t q) { delete q; }
inline int xQueueSend(QueueHandle_t q, const void* data, int) {
  if (q->items.size() == q->capacity)
    return 0;
  const auto* bytes = static_cast<const char*>(data);
  q->items.emplace_back(bytes, bytes + q->size);
  return 1;
}
inline int xQueueReceive(QueueHandle_t q, void* data, int) {
  if (q->items.empty())
    return 0;
  std::memcpy(data, q->items.front().data(), q->size);
  q->items.pop_front();
  return 1;
}
