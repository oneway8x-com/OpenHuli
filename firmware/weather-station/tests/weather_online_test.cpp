#include "../weather_station_online/weather_json.h"
#include <assert.h>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

namespace {
constexpr int64_t now = 1792926000;
std::string read(const char* path) {
  std::ifstream input(path);
  assert(input.good());
  return std::string(std::istreambuf_iterator<char>(input), {});
}
std::string replace(std::string s, const char* from, const char* to) {
  const size_t at = s.find(from);
  assert(at != std::string::npos);
  s.replace(at, strlen(from), to);
  return s;
}
void invalid(const std::string& s, int64_t utc = now) {
  online::Weather untouched;
  untouched.temperature = 42;
  assert(!online::parseWeather(s.c_str(), s.size(), utc, untouched));
  assert(untouched.temperature == 42);
}
void rows(const online::Screen& s) { assert(strlen(s.rows[0]) == 16 && strlen(s.rows[1]) == 16); }
std::string local(int64_t utc) {
  time_t t = time_t(utc);
  tm result = {};
  assert(localtime_r(&t, &result));
  char value[32];
  strftime(value, sizeof(value), "%d/%m/%Y %H:%M", &result);
  return value;
}
} // namespace

int main(int argc, char** argv) {
  setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", 1);
  tzset();
  if (argc == 4 && std::string(argv[1]) == "--validate") {
    const auto payload = read(argv[2]);
    online::Weather weather;
    assert(online::parseWeather(payload.c_str(), payload.size(), strtoll(argv[3], nullptr, 10),
                                weather));
    assert(online::sameLocalDay(weather.forecastUtc, strtoll(argv[3], nullptr, 10)));
    std::cout << "Live Berlin payload accepted by firmware parser\n";
    return 0;
  }
  assert(argc == 2);
  const auto payload = read(argv[1]);
  online::Weather weather;
  assert(online::parseWeather(payload.c_str(), payload.size(), now, weather));
  assert(fabs(weather.temperature - 12.3f) < 0.001f && weather.humidity == 76);
  invalid("");
  invalid("{");
  invalid("{}");
  invalid(std::string(4097, ' '));
  invalid(payload.substr(0, payload.size() / 2));
  invalid(replace(payload, "\"timezone\":", "\"wrong_timezone\":"));
  invalid(replace(payload, "Europe/Berlin", "UTC"));
  invalid(replace(payload, "unixtime", "iso8601"));
  invalid(replace(payload, "km/h", "mph"));
  invalid(replace(payload, "12.3", "null"));
  invalid(replace(payload, "12.3", "\"12.3\""));
  invalid(replace(payload, "12.3", "1e100"));
  invalid(replace(payload, "12.3", "-101"));
  invalid(replace(payload, ": 76", ": 101"));
  invalid(replace(payload, "[35]", "[null]"));
  invalid(replace(payload, "[35]", "[101]"));
  invalid(replace(payload, "[35]", "[]"));
  invalid(replace(payload, "[35]", "[35, 50]"));
  invalid(replace(payload, "[7.2]", "[15]"));
  invalid(replace(payload, "\"is_day\": 1", "\"is_day\": 2"));
  invalid(replace(payload, "\"weather_code\": 3", "\"weather_code\": 100"));
  invalid(replace(payload, "1792926000", "1792926901"));
  invalid(replace(payload, "1792926000", "1700000000"));
  invalid(payload, now + 7200);
  invalid(replace(payload, "{", "{\"error\":true,"));

  online::Cache cache;
  assert(cache.freshness(0, now) == online::Freshness::Missing);
  const uint64_t base = 50ULL * 86400 * 1000; // Beyond 32-bit millis rollover.
  cache.accept(weather, base);
  assert(cache.freshness(base + online::kStaleMs - 1, now) == online::Freshness::Fresh);
  assert(cache.freshness(base + online::kStaleMs, now) == online::Freshness::Stale);
  assert(cache.freshness(base, now + 1800) == online::Freshness::Stale);
  assert(cache.freshness(base + online::kExpireMs, now) == online::Freshness::Expired);
  assert(cache.freshness(base, now + 7200) == online::Freshness::Expired);
  assert(cache.freshness(base, now - 901) == online::Freshness::Expired);

  online::RetrySchedule retry;
  assert(retry.due(0));
  uint64_t clock = base;
  for (uint64_t delay : {60000, 120000, 240000, 480000, 900000, 900000}) {
    retry.failure(clock);
    assert(!retry.due(clock + delay - 1) && retry.due(clock + delay));
    clock += delay;
  }
  retry.success(clock);
  assert(!retry.due(clock + online::kFetchMs - 1) && retry.due(clock + online::kFetchMs));
  retry.failure(clock, 3600);
  assert(!retry.due(clock + 3599999) && retry.due(clock + 3600000));
  retry.success(clock);
  retry.failure(clock);
  assert(retry.due(clock + 60000)); // Successful requests reset backoff.

  for (unsigned page = 0; page < 3; ++page) {
    const auto s = online::screen(page, true, -40, 100, "25/10/2026 12:00", cache, base, now,
                                  "Wi-Fi offline", false);
    rows(s);
    std::cout << s.rows[0] << '\n' << s.rows[1] << '\n';
  }
  const auto dhtError = online::screen(0, false, NAN, NAN, "25/10/2026 12:00", cache, base, now,
                                       "Wi-Fi offline", false);
  assert(std::string(dhtError.rows[0]).find("DHT11 ERROR") == 0);
  assert(std::string(dhtError.rows[1]).find("25/10/2026 12:00") == 0);
  auto s = online::screen(1, true, 20, 50, "", cache, base, now + 1800, "", false);
  assert(std::string(s.rows[0]).find('*') != std::string::npos);
  s = online::screen(1, true, 20, 50, "", cache, base, now, "", true);
  assert(std::string(s.rows[1]).find("open-meteo.com") == 0);
  s = online::screen(1, true, 20, 50, "", cache, base, now + 7200, "", false);
  assert(std::string(s.rows[1]).find("Data expired") == 0);
  online::Cache empty;
  s = online::screen(1, true, 20, 50, "", empty, 0, now, "Set Wi-Fi config", false);
  assert(std::string(s.rows[1]) == "Set Wi-Fi config");
  cache.data.low = -100;
  cache.data.high = 70;
  cache.data.windKmh = 500;
  cache.data.rainPercent = 100;
  s = online::screen(2, true, 20, 50, "", cache, base + online::kStaleMs, now, "", false);
  rows(s);
  assert(std::string(s.rows[0]).find('*') != std::string::npos);
  assert(std::string(s.rows[1]) == "Rain100% W500kmh");
  cache.data.forecastUtc -= 86400;
  s = online::screen(2, true, 20, 50, "", cache, base, now, "", false);
  assert(std::string(s.rows[0]).find("Forecast old") == 0);
  assert(std::string(online::description(0, false)) == "ClearNt");
  assert(std::string(online::description(4, true)) == "Unknown");
  for (int code = 0; code <= 99; ++code)
    assert(strlen(online::description(code, true)) <= 8);
  // Fall-back repeats 02:00; spring-forward skips 02:00. Neither changes API timestamps.
  assert(local(1792889940) == "25/10/2026 02:59");
  assert(local(1792890000) == "25/10/2026 02:00");
  assert(local(1774745940) == "29/03/2026 01:59");
  assert(local(1774746000) == "29/03/2026 03:00");
  assert(online::sameLocalDay(1792879200, now));
  std::cout << "Weather parser, cache, retry, LCD and Berlin DST checks passed\n";
}
