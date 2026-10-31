#pragma once
#include "weather_model.h"
#include <ArduinoJson.h>
#include <initializer_list>

namespace online {
inline bool number(JsonVariantConst value, float low, float high, float& output) {
  if (!value.is<float>())
    return false;
  const float candidate = value.as<float>();
  if (!isfinite(candidate) || candidate < low || candidate > high)
    return false;
  output = candidate;
  return true;
}

// Commit only a complete, plausible response; failures leave the caller untouched.
inline bool parseWeather(const char* json, size_t length, int64_t nowUtc, Weather& output) {
  if (length == 0 || length > 4096)
    return false;
  StaticJsonDocument<4096> document;
  if (deserializeJson(document, json, length) || document["error"].as<bool>())
    return false;
  const JsonObjectConst current = document["current"].as<JsonObjectConst>();
  const JsonObjectConst daily = document["daily"].as<JsonObjectConst>();
  const JsonObjectConst units = document["current_units"].as<JsonObjectConst>();
  const JsonObjectConst dailyUnits = document["daily_units"].as<JsonObjectConst>();
  if (strcmp(document["timezone"] | "", "Europe/Berlin") != 0 ||
      strcmp(units["time"] | "", "unixtime") != 0 ||
      strcmp(dailyUnits["time"] | "", "unixtime") != 0 ||
      strcmp(units["temperature_2m"] | "", "°C") != 0 ||
      strcmp(units["relative_humidity_2m"] | "", "%") != 0 ||
      strcmp(units["wind_speed_10m"] | "", "km/h") != 0 ||
      strcmp(dailyUnits["temperature_2m_min"] | "", "°C") != 0 ||
      strcmp(dailyUnits["temperature_2m_max"] | "", "°C") != 0 ||
      strcmp(dailyUnits["precipitation_probability_max"] | "", "%") != 0)
    return false;
  if (!current["time"].is<int64_t>() || !current["weather_code"].is<int>() ||
      !current["is_day"].is<int>())
    return false;
  for (const char* key :
       {"time", "temperature_2m_min", "temperature_2m_max", "precipitation_probability_max"}) {
    if (!daily[key].is<JsonArrayConst>() || daily[key].size() != 1)
      return false;
  }
  if (!daily["time"][0].is<int64_t>())
    return false;
  Weather w;
  w.currentUtc = current["time"].as<int64_t>();
  w.forecastUtc = daily["time"][0].as<int64_t>();
  w.code = current["weather_code"].as<int>();
  const int day = current["is_day"].as<int>();
  w.isDay = day == 1;
  if (w.currentUtc < 1704067200 || w.currentUtc > nowUtc + 900 ||
      nowUtc - w.currentUtc >= int64_t(kExpireMs / 1000) || w.forecastUtc < nowUtc - 2 * 86400 ||
      w.forecastUtc > nowUtc + 86400 || w.code < 0 || w.code > 99 || day < 0 || day > 1)
    return false;
  if (!number(current["temperature_2m"], -100, 70, w.temperature) ||
      !number(current["relative_humidity_2m"], 0, 100, w.humidity) ||
      !number(current["wind_speed_10m"], 0, 500, w.windKmh) ||
      !number(daily["temperature_2m_min"][0], -100, 70, w.low) ||
      !number(daily["temperature_2m_max"][0], -100, 70, w.high) ||
      !number(daily["precipitation_probability_max"][0], 0, 100, w.rainPercent) || w.low > w.high)
    return false;
  output = w;
  return true;
}
} // namespace online
