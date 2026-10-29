#pragma once

#include <stdint.h>

// GPIO numbers printed on the S2 Mini, not Arduino Uno pin assignments.
// LCD outputs require suitable 3.3 V -> 5 V translation unless the actual
// LCD datasheet explicitly guarantees 3.3 V input-high compatibility at 5 V.
namespace config {
constexpr uint8_t kDhtData = 1;
constexpr uint8_t kLcdRs = 2;
constexpr uint8_t kLcdEnable = 3;
constexpr uint8_t kLcdD4 = 4;
constexpr uint8_t kLcdD5 = 5;
constexpr uint8_t kLcdD6 = 6;
constexpr uint8_t kLcdD7 = 7;

constexpr uint32_t kSensorWarmupMs = 2000;
constexpr uint32_t kSampleIntervalMs = 3000;
constexpr uint32_t kDisplayRefreshMs = 250;
constexpr uint32_t kWifiRetryMs = 30000;
// Europe/Berlin: CET in winter, CEST in summer (POSIX TZ syntax).
constexpr char kTimezone[] = "CET-1CEST,M3.5.0,M10.5.0/3";
constexpr char kNtpServer1[] = "pool.ntp.org";
constexpr char kNtpServer2[] = "time.nist.gov";
static_assert(kSampleIntervalMs >= 2000, "Allow at least 2 s between DHT reads");

constexpr bool pinsAreUsableAndDistinct() {
  const uint8_t pins[] = {kDhtData, kLcdRs, kLcdEnable, kLcdD4, kLcdD5, kLcdD6, kLcdD7};
  for (unsigned i = 0; i < sizeof(pins); ++i) {
    // Exposed S2 Mini GPIOs; exclude native USB (19/20) and boot straps.
    if (!((pins[i] >= 1 && pins[i] <= 18) || pins[i] == 21 || (pins[i] >= 33 && pins[i] <= 40))) {
      return false;
    }
    for (unsigned j = 0; j < i; ++j) {
      if (pins[i] == pins[j])
        return false;
    }
  }
  return true;
}
static_assert(pinsAreUsableAndDistinct(), "Select distinct exposed S2 Mini GPIOs");
} // namespace config
