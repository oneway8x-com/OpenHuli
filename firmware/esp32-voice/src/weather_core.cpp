#include "weather_core.h"
#include "voice_core.h"
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
namespace openhuli::weather {
bool ClockGuard::observe(int64_t utc, uint64_t ms) {
  if (failed_)
    return false;
  if (utc < 1704067200000LL) {
    if (anchor_utc_)
      failed_ = true;
    return false;
  }
  if (!anchor_utc_) {
    anchor_utc_ = last_utc_ = utc;
    anchor_ms_ = last_ms_ = ms;
    return true;
  }
  if (ms < last_ms_) {
    failed_ = true;
    return false;
  }
  const int64_t expected = anchor_utc_ + int64_t(ms - anchor_ms_);
  if (ms < last_ms_ || utc < last_utc_ || utc < expected - 1000 || utc > expected + 1000) {
    failed_ = true;
    return false;
  }
  last_utc_ = utc;
  last_ms_ = ms;
  return true;
}
int64_t ClockGuard::now(uint64_t ms) const {
  return !failed_ && anchor_utc_ && ms >= last_ms_ ? anchor_utc_ + int64_t(ms - anchor_ms_) : 0;
}
Reading decode_dht11(const Pulse* p, size_t count) {
  if (!p || count < 82 || count > 96)
    return {};
  size_t start = count;
  for (size_t i = 0; i + 81 < count; ++i)
    if (!p[i].high && p[i].micros >= 65 && p[i].micros <= 110 && p[i + 1].high &&
        p[i + 1].micros >= 65 && p[i + 1].micros <= 110) {
      start = i + 2;
      break;
    }
  if (start == count)
    return {};
  uint8_t data[5]{};
  for (size_t bit = 0; bit < 40; ++bit) {
    const auto low = p[start + bit * 2], high = p[start + bit * 2 + 1];
    if (low.high || !high.high || low.micros < 35 || low.micros > 75 || high.micros < 15 ||
        high.micros > 90)
      return {};
    data[bit / 8] = uint8_t((data[bit / 8] << 1) | (high.micros > 50));
  }
  if (uint8_t(data[0] + data[1] + data[2] + data[3]) != data[4] || data[0] > 100 || data[1] > 9 ||
      data[2] > 50 || data[3] > 9)
    return {};
  const float humidity = data[0] + data[1] * .1f, temperature = data[2] + data[3] * .1f;
  if (humidity > 100 || temperature > 50)
    return {};
  return {true, temperature, humidity};
}
bool format_utc(int64_t ms, char* out, size_t capacity) {
  if (!out || capacity < 25 || ms < 1704067200000LL || ms >= 4102444800000LL)
    return false;
  const time_t seconds = ms / 1000;
  std::tm parts{};
  if (!gmtime_r(&seconds, &parts))
    return false;
  const int n = std::snprintf(out, capacity, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                              parts.tm_year + 1900, parts.tm_mon + 1, parts.tm_mday, parts.tm_hour,
                              parts.tm_min, parts.tm_sec, int(ms % 1000));
  return n == 24;
}
bool parse_utc(const char* s, int64_t& out) {
  if (!s || std::strlen(s) != 24)
    return false;
  unsigned y, m, d, h, min, sec, ms;
  int n = 0;
  if (std::sscanf(s, "%4u-%2u-%2uT%2u:%2u:%2u.%3uZ%n", &y, &m, &d, &h, &min, &sec, &ms, &n) != 7 ||
      n != 24 || y < 2024 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 ||
      sec > 59 || ms > 999)
    return false;
  // Civil date to Unix days; independent of TZ and timegm availability on the MCU.
  const int year = int(y) - (m <= 2);
  const int era = year / 400;
  const unsigned yoe = unsigned(year - era * 400);
  const unsigned doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  out = ((int64_t(era) * 146097 + doe - 719468) * 86400 + h * 3600 + min * 60 + sec) * 1000 + ms;
  char canonical[25];
  return format_utc(out, canonical, sizeof(canonical)) && !std::strcmp(s, canonical);
}
bool write_presence(char* out, size_t cap, const char* device, const char* boot, uint32_t seq,
                    bool online, int64_t now) {
  char timestamp[25];
  if (!valid_id(device) || !valid_id(boot) || !format_utc(now, timestamp, sizeof(timestamp)))
    return false;
  const int n = std::snprintf(
      out, cap,
      "{\"version\":1,\"type\":\"device.presence\",\"messageId\":\"%s-p%lu\",\"deviceId\":\"%s\","
      "\"bootId\":\"%s\",\"sequence\":%lu,\"status\":\"%s\",\"sentAt\":\"%s\"}",
      boot, (unsigned long)seq, device, boot, (unsigned long)seq, online ? "online" : "offline",
      timestamp);
  return n >= 0 && size_t(n) < cap && std::strlen(boot) <= 48;
}
bool write_telemetry(char* out, size_t cap, const char* device, const char* boot, uint32_t seq,
                     int64_t at, Reading reading) {
  char timestamp[25], values[256];
  if (!valid_id(device) || !valid_id(boot) || std::strlen(boot) > 48 ||
      !format_utc(at, timestamp, sizeof(timestamp)))
    return false;
  if (reading.valid && (!std::isfinite(reading.temperature) || !std::isfinite(reading.humidity) ||
                        reading.temperature < 0 || reading.temperature > 50 ||
                        reading.humidity < 0 || reading.humidity > 100))
    return false;
  if (reading.valid)
    std::snprintf(values, sizeof(values),
                  "\"readings\":[{\"metric\":\"temperature\",\"value\":%.1f,\"unit\":\"degC\"},{"
                  "\"metric\":\"humidity\",\"value\":%.1f,\"unit\":\"percent\"}]",
                  double(reading.temperature), double(reading.humidity));
  else
    std::snprintf(values, sizeof(values),
                  "\"readings\":[],\"sensorErrors\":[{\"metric\":\"temperature\",\"code\":\"read_"
                  "failed\"},{\"metric\":\"humidity\",\"code\":\"read_failed\"}]");
  const int n = std::snprintf(
      out, cap,
      "{\"version\":1,\"type\":\"device.telemetry\",\"messageId\":\"%s-t%lu\",\"deviceId\":\"%s\","
      "\"bootId\":\"%s\",\"sequence\":%lu,\"sampledAt\":\"%s\",%s}",
      boot, (unsigned long)seq, device, boot, (unsigned long)seq, timestamp, values);
  return n >= 0 && size_t(n) < cap;
}
bool write_manifest(char* out, size_t cap, const char* device, const char* boot, bool mic,
                    size_t display) {
  if (!valid_id(device) || !valid_id(boot) || std::strlen(boot) > 48 || display > display_limit)
    return false;
  char screen[100]{};
  if (display)
    std::snprintf(screen, sizeof(screen), ",{\"kind\":\"display\",\"maxTextLength\":%u}",
                  unsigned(display));
  const char* microphone = mic ? ",{\"kind\":\"microphone\",\"format\":{\"encoding\":\"pcm_s16le\","
                                 "\"sampleRateHz\":16000,\"channels\":1,\"chunkDurationMs\":20}}"
                               : "";
  const int n = std::snprintf(
      out, cap,
      "{\"version\":1,\"type\":\"device.manifest\",\"messageId\":\"%s-manifest\",\"deviceId\":\"%"
      "s\",\"firmwareVersion\":\"weather-reference-v1\",\"capabilities\":[{\"kind\":"
      "\"temperature\"},{\"kind\":\"humidity\"},{\"kind\":\"ping\"}%s%s]}",
      boot, device, microphone, screen);
  return n >= 0 && size_t(n) < cap;
}
bool Packet::append(const char* data, size_t length, size_t offset, size_t total, bool retained) {
  if (retained || !data || !total || total > command_bytes || length > total ||
      offset > total - length) {
    clear();
    return false;
  }
  if (!offset) {
    clear();
    active_ = true;
    expected_ = total;
  }
  if (!active_ || expected_ != total || used_ != offset) {
    clear();
    return false;
  }
  std::memcpy(bytes_.data() + used_, data, length);
  used_ += length;
  bytes_[used_] = '\0';
  return true;
}
static bool same(const Command& a, const Command& b) {
  return !std::strcmp(a.message_id, b.message_id) && !std::strcmp(a.command_id, b.command_id) &&
         !std::strcmp(a.execution_id, b.execution_id) && a.issued_at == b.issued_at &&
         a.expires_at == b.expires_at && a.action == b.action &&
         a.text_supported == b.text_supported && !std::strcmp(a.text, b.text);
}
Result Receiver::receive(const Command& c, int64_t now, bool ready, DisplayWrite display,
                         size_t maximum, Clock clock, Reserve reserve) {
  const bool backwards = now < last_clock_;
  if (now > last_clock_)
    last_clock_ = now;
  if (!ready || backwards || !floor_ || c.issued_at < floor_ || c.issued_at > now ||
      c.expires_at <= now || c.expires_at <= c.issued_at || c.expires_at - c.issued_at > 30000)
    return {Outcome::expired, now};
  if (!valid_id(c.message_id) || !valid_id(c.command_id) || !valid_id(c.execution_id))
    return {Outcome::conflict, now};
  for (auto& e : entries_) {
    if (e.used && e.command.expires_at <= now)
      e.used = false;
    if (e.used && !std::strcmp(e.command.command_id, c.command_id))
      return same(e.command, c) ? e.result : Result{Outcome::conflict, now};
  }
  if (c.action == Action::display &&
      (!display || !maximum || maximum > display_limit || !c.text_supported || !*c.text ||
       std::strlen(c.text) > maximum))
    return {Outcome::unsupported, now};
  for (auto& e : entries_)
    if (!e.used) {
      e.used = true;
      e.command = c;
      e.result = {Outcome::unknown, now}; // Reserve before physical effect.
      const int64_t before = clock ? clock() : now;
      if (before < now || before >= c.expires_at) {
        e.result = {Outcome::expired, before};
        return e.result;
      }
      if (reserve && !reserve(c.expires_at)) {
        e.result = {Outcome::failed, before};
        return e.result;
      }
      const int64_t dispatched = clock ? clock() : before;
      if (dispatched < before || dispatched >= c.expires_at) {
        e.result = {Outcome::expired, dispatched};
        return e.result;
      }
      e.result.outcome = c.action == Action::ping ? Outcome::succeeded : display(c.text);
      e.result.completed_at = clock ? clock() : now;
      if (e.result.completed_at < before || e.result.completed_at >= c.expires_at)
        e.result.outcome = Outcome::unknown;
      return e.result;
    }
  return {Outcome::full, now};
}
bool write_result(char* out, size_t cap, const char* device, const Command& c, Result r) {
  char at[25], error[350]{};
  if (!valid_id(device) || !valid_id(c.command_id) || !valid_id(c.execution_id) ||
      !format_utc(r.completed_at, at, sizeof(at)) || r.outcome == Outcome::conflict)
    return false;
  const char *status = "failed", *code = "execution_failed";
  switch (r.outcome) {
  case Outcome::succeeded:
    status = "succeeded";
    break;
  case Outcome::expired:
    status = "expired";
    code = "expired";
    break;
  case Outcome::unsupported:
    code = "unsupported_capability";
    break;
  case Outcome::unknown:
    status = "unknown";
    code = "outcome_unknown";
    break;
  case Outcome::full:
    code = "limit_exceeded";
    break;
  default:
    break;
  }
  if (r.outcome != Outcome::succeeded)
    std::snprintf(error, sizeof(error),
                  ",\"error\":{\"code\":\"%s\",\"message\":\"Device command did not confirm "
                  "success\",\"correlationId\":\"%s\",\"retryable\":false}",
                  code, c.command_id);
  const int n = std::snprintf(
      out, cap,
      "{\"version\":1,\"type\":\"device.command.result\",\"messageId\":\"%s\",\"deviceId\":\"%s\","
      "\"commandId\":\"%s\",\"executionId\":\"%s\",\"completedAt\":\"%s\",\"status\":\"%s\"%s}",
      c.command_id, device, c.command_id, c.execution_id, at, status, error);
  return n >= 0 && size_t(n) < cap;
}
} // namespace openhuli::weather
