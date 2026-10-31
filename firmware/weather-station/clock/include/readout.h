#pragma once

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace weather {
enum class Status { WarmingUp, Ready, SensorError };

struct Frame {
  char rows[2][17] = {};
};

inline void padLine(char (&line)[17]) {
  const unsigned length = strlen(line);
  for (unsigned i = length; i < 16; ++i)
    line[i] = ' ';
  line[16] = '\0';
}

class Readout {
public:
  Readout(uint32_t startedAt, uint32_t warmupMs, uint32_t intervalMs)
      : lastAttempt_(startedAt), warmupMs_(warmupMs), intervalMs_(intervalMs) {}

  bool due(uint32_t now) const {
    // Unsigned subtraction also works across the millis() wraparound.
    return uint32_t(now - lastAttempt_) >= (attempted_ ? intervalMs_ : warmupMs_);
  }

  void record(uint32_t now, float temperature, float humidity) {
    attempted_ = true;
    lastAttempt_ = now;
    // Broad plausibility bounds also keep unexpected data off the LCD.
    const bool valid = isfinite(temperature) && isfinite(humidity) && temperature >= -40 &&
                       temperature <= 80 && humidity >= 0 && humidity <= 100;
    status_ = valid ? Status::Ready : Status::SensorError;
    temperature_ = valid ? temperature : 0;
    humidity_ = valid ? humidity : 0;
  }

  Status status() const { return status_; }

  Frame frame(const char* clockRow = "Clock not synced") const {
    Frame result;
    if (status_ == Status::WarmingUp) {
      snprintf(result.rows[0], 17, "DHT11 warming up");
    } else if (status_ == Status::SensorError) {
      snprintf(result.rows[0], 17, "DHT11 read error");
    } else {
      snprintf(result.rows[0], 17, "T:%4.1fC H:%3.0f%%", double(temperature_), double(humidity_));
    }
    snprintf(result.rows[1], 17, "%s", clockRow);
    padLine(result.rows[0]);
    padLine(result.rows[1]);
    return result;
  }

private:
  uint32_t lastAttempt_;
  uint32_t warmupMs_;
  uint32_t intervalMs_;
  bool attempted_ = false;
  Status status_ = Status::WarmingUp;
  float temperature_ = 0;
  float humidity_ = 0;
};
} // namespace weather
