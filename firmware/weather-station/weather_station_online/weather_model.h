#pragma once
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

namespace online {
constexpr uint64_t kFetchMs = 15ULL * 60 * 1000;
constexpr uint64_t kStaleMs = 30ULL * 60 * 1000;
constexpr uint64_t kExpireMs = 2ULL * 60 * 60 * 1000;

struct Weather {
  int64_t currentUtc = 0, forecastUtc = 0;
  float temperature = 0, humidity = 0, windKmh = 0;
  float low = 0, high = 0, rainPercent = 0;
  int code = 0;
  bool isDay = true;
};

enum class Freshness { Missing, Fresh, Stale, Expired };

class RetrySchedule {
public:
  bool due(uint64_t now) const { return now >= dueAt_; }
  void success(uint64_t now) {
    dueAt_ = now + kFetchMs;
    backoff_ = 60000;
  }
  void failure(uint64_t now, uint32_t retryAfterSeconds = 0) {
    uint64_t delay = backoff_;
    const uint64_t requested = uint64_t(retryAfterSeconds) * 1000;
    if (requested > delay)
      delay = requested;
    dueAt_ = now + delay;
    backoff_ = backoff_ < kFetchMs / 2 ? backoff_ * 2 : kFetchMs;
  }

private:
  uint64_t dueAt_ = 0, backoff_ = 60000;
};

class Cache {
public:
  void accept(const Weather& weather, uint64_t now) {
    data = weather;
    receivedAt = now;
    hasData = true;
  }
  Freshness freshness(uint64_t now, int64_t utc) const {
    if (!hasData)
      return Freshness::Missing;
    const uint64_t receivedAge = now >= receivedAt ? now - receivedAt : kExpireMs;
    const int64_t sourceAge = utc - data.currentUtc;
    if (receivedAge >= kExpireMs || sourceAge >= int64_t(kExpireMs / 1000) || sourceAge < -900)
      return Freshness::Expired;
    if (receivedAge >= kStaleMs || sourceAge >= int64_t(kStaleMs / 1000))
      return Freshness::Stale;
    return Freshness::Fresh;
  }
  Weather data;
  uint64_t receivedAt = 0;
  bool hasData = false;
};

struct Screen {
  char rows[2][17] = {};
};
inline void pad(char (&row)[17]) {
  for (unsigned i = strlen(row); i < 16; ++i)
    row[i] = ' ';
  row[16] = '\0';
}
inline bool sameLocalDay(int64_t a, int64_t b) {
  const time_t x = time_t(a), y = time_t(b);
  tm tx = {}, ty = {};
  if (!localtime_r(&x, &tx) || !localtime_r(&y, &ty))
    return false;
  return tx.tm_year == ty.tm_year && tx.tm_yday == ty.tm_yday;
}
inline const char* description(int code, bool day) {
  switch (code) {
  case 0:
    return day ? "Clear" : "ClearNt";
  case 1:
    return "MainClr";
  case 2:
    return "PartCld";
  case 3:
    return "Overcast";
  case 45:
  case 48:
    return "Fog";
  case 51:
  case 53:
  case 55:
    return "Drizzle";
  case 56:
  case 57:
    return "IceDriz";
  case 61:
  case 63:
  case 65:
    return "Rain";
  case 66:
  case 67:
    return "IceRain";
  case 71:
  case 73:
  case 75:
  case 77:
    return "Snow";
  case 80:
  case 81:
  case 82:
    return "Showers";
  case 85:
  case 86:
    return "SnowShwr";
  case 95:
  case 97:
    return "TStorm";
  case 96:
  case 99:
    return "Hail";
  default:
    return "Unknown";
  }
}

inline Screen screen(unsigned page, bool roomValid, float temperature, float humidity,
                     const char* clockRow, const Cache& cache, uint64_t now, int64_t utc,
                     const char* unavailable, bool credit) {
  Screen result;
  if (page == 0) {
    if (roomValid)
      snprintf(result.rows[0], 17, "Room%5.1fC %3.0f%%", double(temperature), double(humidity));
    else
      snprintf(result.rows[0], 17, "DHT11 ERROR");
    snprintf(result.rows[1], 17, "%s", clockRow);
  } else {
    const Freshness state = cache.freshness(now, utc);
    const Weather& w = cache.data;
    if (state == Freshness::Missing || state == Freshness::Expired) {
      snprintf(result.rows[0], 17, "Berlin weather");
      snprintf(result.rows[1], 17, "%s",
               state == Freshness::Expired ? "Data expired" : unavailable);
    } else if (page == 1) {
      snprintf(result.rows[0], 17, "Berlin %.1fC%s", double(w.temperature),
               state == Freshness::Stale ? "*" : "");
      if (credit)
        snprintf(result.rows[1], 17, "open-meteo.com");
      else
        snprintf(result.rows[1], 17, "%-8.8s H%3.0f%%", description(w.code, w.isDay),
                 double(w.humidity));
    } else if (!sameLocalDay(w.forecastUtc, utc)) {
      snprintf(result.rows[0], 17, "Forecast old");
      snprintf(result.rows[1], 17, "Waiting refresh");
    } else {
      snprintf(result.rows[0], 17, "Lo%3.0fC Hi%3.0fC%s", double(w.low), double(w.high),
               state == Freshness::Stale ? "*" : "");
      snprintf(result.rows[1], 17, "Rain%3.0f%% W%3.0fkmh", double(w.rainPercent),
               double(w.windKmh));
    }
  }
  pad(result.rows[0]);
  pad(result.rows[1]);
  return result;
}
} // namespace online
