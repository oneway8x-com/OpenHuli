#pragma once
// Copy to config.local.h (ignored). Do not assign GPIOs until the exact board and microphone are
// checked.
namespace config {
constexpr bool hardware_confirmed = false;
constexpr int mic_bclk = -1;
constexpr int mic_ws = -1;
constexpr int mic_data = -1;
constexpr int button =
    -1; // Active-low button to GND, internal pull-up. Never use BOOT as a guessed PTT pin.
constexpr int led = -1; // Optional external indicator; -1 keeps it disabled.
constexpr bool led_active_high = true;
constexpr bool microphone_left_slot = true; // Must match the microphone's hardware L/R selection.
constexpr unsigned sample_shift = 16;       // 32-bit signed I2S slot -> signed PCM16, saturating.
constexpr char wifi_ssid[] = "";
constexpr char wifi_password[] = "";
constexpr char voice_host[] =
    ""; // DNS hostname only. HTTPS/WSS reverse proxy certificate must match.
constexpr unsigned voice_port = 443;
constexpr char device_voice_token[] =
    ""; // One-time purpose=voice credential; never an AI/provider/owner key.
constexpr char root_ca[] =
    R"PEM()PEM"; // Trusted deployment CA PEM. No insecure/fingerprint-only fallback.
constexpr bool show_response_text =
    false; // Explicit opt-in: private answers may appear in local serial logs.
} // namespace config
