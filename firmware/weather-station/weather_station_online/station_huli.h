#pragma once
#include "weather_model.h"
#include <OpenHuliProtocol.h>

namespace station {
constexpr uint32_t telemetry_interval = 30000;
constexpr uint32_t display_hold = 15000;

inline openhuli::device::Reading roomReading(float temperature, float humidity) {
  const bool valid = isfinite(temperature) && isfinite(humidity) && temperature >= -40 &&
                     temperature <= 80 && humidity >= 0 && humidity <= 100;
  return {valid, valid ? temperature : 0, valid ? humidity : 0};
}

// Called only for a new physical read. No cached samples or offline replay.
class Publisher {
public:
  template <typename Client>
  bool sample(Client& client, uint32_t tick, float temperature, float humidity) {
    if (attempted_ && uint32_t(tick - last_) < telemetry_interval)
      return false;
    attempted_ = true;
    last_ = tick;
    if (!client.connected())
      return false;
    const auto reading = roomReading(temperature, humidity);
    const int64_t sampled_at = client.now();
    return sampled_at > 0 && client.publish(reading, sampled_at);
  }

private:
  bool attempted_ = false;
  uint32_t last_ = 0;
};

class DisplayMessage {
public:
  bool set(const char* text, uint32_t tick) {
    if (!text)
      return false;
    const size_t length = strlen(text);
    if (!length || length > 32)
      return false;
    for (size_t i = 0; i < length; ++i)
      if (text[i] < 32 || text[i] > 126)
        return false;
    for (size_t row = 0; row < 2; ++row) {
      for (size_t column = 0; column < 16; ++column) {
        const size_t i = row * 16 + column;
        screen_.rows[row][column] = i < length ? text[i] : ' ';
      }
      screen_.rows[row][16] = '\0';
    }
    started_ = tick;
    active_ = true;
    return true;
  }
  bool active(uint32_t tick) const { return active_ && uint32_t(tick - started_) < display_hold; }
  const online::Screen& screen() const { return screen_; }

private:
  online::Screen screen_;
  uint32_t started_ = 0;
  bool active_ = false;
};
} // namespace station
