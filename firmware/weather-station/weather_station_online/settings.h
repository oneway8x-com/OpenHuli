#pragma once
#include <stdint.h>

namespace settings {
// Outer headers J2 and J3; same map as weather_station_test. Confirm actual wiring before upload.
constexpr uint8_t kLcdRs = 3, kLcdEnable = 5;
constexpr uint8_t kLcdD4 = 7, kLcdD5 = 12, kLcdD6 = 33, kLcdD7 = 35;
constexpr uint8_t kDhtData = 37;
constexpr uint32_t kSensorIntervalMs = 2000;
constexpr uint32_t kWifiRetryMs = 30000;
constexpr uint32_t kDisplayIntervalMs = 250;
constexpr uint32_t kPageMs = 15000;
constexpr char kTimezone[] = "CET-1CEST,M3.5.0,M10.5.0/3";
// Public Berlin city-centre coordinates returned by Open-Meteo geocoding.
constexpr char kApiUrl[] =
    "https://api.open-meteo.com/v1/forecast?latitude=52.52437&longitude=13.41053"
    "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day"
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max"
    "&forecast_days=1&temperature_unit=celsius&wind_speed_unit=kmh"
    "&timeformat=unixtime&timezone=Europe%2FBerlin";
constexpr uint32_t kConnectTimeoutMs = 5000;
constexpr uint32_t kReadTimeoutMs = 8000;
constexpr uint32_t kTlsTimeoutSeconds = 8;
constexpr unsigned kMaxResponseBytes = 4096;
} // namespace settings
