#pragma once
namespace config {
#if defined(OPENHULI_LINK_CHECK)
volatile bool enabled = false;
#else
constexpr bool enabled = false;
#endif // Explicit opt-in only after checking hardware, power and UART.
constexpr const char* wifi_ssid = "";
constexpr const char* wifi_password = "";
constexpr const char* device_id = "";
constexpr const char* mqtt_host = "";
constexpr uint16_t mqtt_port = 8883;
constexpr const char* mqtt_username = "";
constexpr const char* mqtt_client_id = "";
constexpr const char* mqtt_token = "";
constexpr const char* root_ca = "";
constexpr uint8_t sensors = 0; // Bit 0 temperature, bit 1 humidity; must match the AVR and pairing.
constexpr uint8_t display_limit = 0; // Optional printable ASCII display, at most 32 characters.
}
