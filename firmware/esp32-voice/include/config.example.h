#pragma once
// Copy to config.local.h (ignored). Do not assign GPIOs until the exact board and microphone are
// checked.
// CI keeps all adapters linked without assigning pins or enabling any hardware.
#ifdef OPENHULI_LINK_CHECK
#define OPENHULI_SETTING inline const volatile
#define OPENHULI_TEXT inline char
#else
#define OPENHULI_SETTING constexpr
#define OPENHULI_TEXT constexpr char
#endif
namespace config {
OPENHULI_SETTING bool hardware_confirmed = false;
OPENHULI_SETTING bool voice_enabled = true; // False permits a separate weather-only node.
OPENHULI_SETTING int mic_bclk = -1;
OPENHULI_SETTING int mic_ws = -1;
OPENHULI_SETTING int mic_data = -1;
OPENHULI_SETTING int button =
    -1; // Active-low button to GND, internal pull-up. Never use BOOT as a guessed PTT pin.
OPENHULI_SETTING int led = -1; // Optional external indicator; -1 keeps it disabled.
OPENHULI_SETTING bool led_active_high = true;
OPENHULI_SETTING bool microphone_left_slot =
    true;                                    // Must match the microphone's hardware L/R selection.
OPENHULI_SETTING unsigned sample_shift = 16; // 32-bit signed I2S slot -> signed PCM16, saturating.
OPENHULI_TEXT wifi_ssid[] = "";
OPENHULI_TEXT wifi_password[] = "";
OPENHULI_TEXT voice_host[] =
    ""; // DNS hostname only. HTTPS/WSS reverse proxy certificate must match.
OPENHULI_SETTING unsigned voice_port = 443;
OPENHULI_TEXT device_voice_token[] =
    ""; // One-time purpose=voice credential; never an AI/provider/owner key.
OPENHULI_TEXT root_ca[] =
    R"PEM()PEM"; // Trusted deployment CA PEM. No insecure/fingerprint-only fallback.
OPENHULI_SETTING bool show_response_text =
    false; // Explicit opt-in: private answers may appear in local serial logs.
// Weather/MQTT are optional. Confirm the exact sensor, LCD, levels and wiring first.
OPENHULI_SETTING bool weather_enabled = false;
OPENHULI_SETTING int dht_data = -1; // DHT11 only; external pull-up to a verified 3.3 V-safe supply.
OPENHULI_TEXT device_id[] = "";     // Owner-issued endpoint ID, not a Tenant claim.
OPENHULI_TEXT mqtt_host[] = "";
OPENHULI_SETTING unsigned mqtt_port = 8883;
OPENHULI_TEXT mqtt_username[] = "";     // Copy issued mqttUsername verbatim.
OPENHULI_TEXT mqtt_client_id[] = "";    // Copy issued mqttClientId verbatim.
OPENHULI_TEXT device_mqtt_token[] = ""; // Separate purpose=mqtt credential.
OPENHULI_TEXT mqtt_root_ca[] = R"PEM()PEM";
OPENHULI_SETTING bool display_enabled = false; // User selected LCD1602, 16-pin parallel header.
OPENHULI_SETTING bool display_confirmed =
    false; // Confirm HD44780 compatibility and logic levels first.
OPENHULI_SETTING int lcd_rs = -1, lcd_enable = -1, lcd_d4 = -1, lcd_d5 = -1, lcd_d6 = -1,
                     lcd_d7 = -1;
// Four-bit, write-only interface: LCD R/W tied to GND. No pin numbers are proposed.
} // namespace config

#undef OPENHULI_SETTING
#undef OPENHULI_TEXT
