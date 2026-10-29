#pragma once

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace hardware_test {
constexpr uint32_t kReadIntervalMs = 2000;

struct Screen {
  char rows[2][17] = {};
  bool valid = false;
};

inline void pad(char (&row)[17]) {
  for (unsigned i = strlen(row); i < 16; ++i)
    row[i] = ' ';
  row[16] = '\0';
}

inline Screen startupScreen() {
  Screen result;
  snprintf(result.rows[0], 17, "Weather Station");
  snprintf(result.rows[1], 17, "Starting...");
  pad(result.rows[0]);
  pad(result.rows[1]);
  return result;
}

inline bool readDue(uint32_t now, uint32_t lastRead) {
  return uint32_t(now - lastRead) >= kReadIntervalMs;
}

inline Screen sampleScreen(float temperature, float humidity) {
  Screen result;
  // Broad sanity bounds, not a statement of DHT11 measurement accuracy/range.
  result.valid = isfinite(temperature) && isfinite(humidity) && temperature >= -40 &&
                 temperature <= 80 && humidity >= 0 && humidity <= 100;
  if (result.valid) {
    snprintf(result.rows[0], 17, "Temp: %.1f C", double(temperature));
    snprintf(result.rows[1], 17, "Humidity: %.0f%%", double(humidity));
  } else {
    snprintf(result.rows[0], 17, "DHT11 ERROR");
    snprintf(result.rows[1], 17, "Check wiring");
  }
  pad(result.rows[0]);
  pad(result.rows[1]);
  return result;
}
} // namespace hardware_test
