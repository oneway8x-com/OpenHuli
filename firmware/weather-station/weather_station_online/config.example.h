#pragma once

// Copy to config.local.h. Keep Wi-Fi in the separate ignored wifi_config.h.
// Use only the one-time MQTT identity issued by the OpenHuli owner console.
namespace huli_config {
#ifdef OPENHULI_LINK_CHECK
constexpr bool enabled = true; // Compile/link coverage only; never upload this image.
#else
constexpr bool enabled = false; // Set true privately after pairing and configuring TLS.
#endif
constexpr const char* device_id = "";
constexpr const char* mqtt_host = "";
constexpr unsigned mqtt_port = 8883;
constexpr const char* mqtt_username = "";
constexpr const char* mqtt_client_id = "";
constexpr const char* mqtt_token = "";
constexpr const char* root_ca = ""; // Broker's PEM CA; independent of the weather API roots.
} // namespace huli_config
