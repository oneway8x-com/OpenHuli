#include <assert.h>
#include <initializer_list>
#include <limits>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "clock_display.h"
#include "config.h"
#include "readout.h"

int main() {
  weather::Readout station(0, 2000, 3000);
  assert(!station.due(1999));
  assert(station.due(2000));
  assert(station.status() == weather::Status::WarmingUp);
  station.record(2000, 23, 45);
  auto frame = station.frame();
  assert(strcmp(frame.rows[0], "T:23.0C H: 45%  ") == 0);
  assert(strcmp(frame.rows[1], "Clock not synced") == 0);
  assert(!station.due(4999));
  assert(station.due(5000));

  const float nan = std::numeric_limits<float>::quiet_NaN();
  station.record(5000, nan, 45);
  frame = station.frame();
  assert(station.status() == weather::Status::SensorError);
  assert(strstr(frame.rows[0], "error") != nullptr);
  assert(strstr(frame.rows[0], "23.0") == nullptr);
  assert(!station.due(7999));
  assert(station.due(8000));
  station.record(8000, 24, 50);
  assert(station.status() == weather::Status::Ready);

  const float invalid[][2] = {
      {20, nan}, {20, -1}, {20, 101}, {81, 50}, {std::numeric_limits<float>::infinity(), 50}};
  for (const auto& sample : invalid) {
    station.record(11000, sample[0], sample[1]);
    assert(station.status() == weather::Status::SensorError);
  }
  station.record(14000, -40, 100);
  frame = station.frame();
  assert(station.status() == weather::Status::Ready);
  assert(strstr(frame.rows[0], "-40.0") != nullptr);
  assert(strstr(frame.rows[0], "100%") != nullptr);
  assert(strlen(frame.rows[0]) == 16 && strlen(frame.rows[1]) == 16);
  station.record(17000, 0, 0);
  frame = station.frame();
  assert(strcmp(frame.rows[0], "T: 0.0C H:  0%  ") == 0);

  weather::Readout rollover(UINT32_MAX - 1000, 2000, 3000);
  assert(!rollover.due(998));
  assert(rollover.due(999));
  rollover.record(UINT32_MAX - 1000, 20, 50);
  assert(!rollover.due(1998));
  assert(rollover.due(1999));
  char clockRow[17];
  tm date = {};
  date.tm_year = 126;
  date.tm_mon = 9;
  date.tm_mday = 24;
  date.tm_hour = 18;
  date.tm_min = 45;
  weather::clockLine(clockRow, weather::ClockStatus::Ready, &date);
  assert(strcmp(clockRow, "24/10/2026 18:45") == 0);
  frame = station.frame(clockRow);
  assert(strcmp(frame.rows[1], clockRow) == 0);
  station.record(20000, nan, nan);
  frame = station.frame(clockRow);
  assert(strstr(frame.rows[0], "error") != nullptr);
  assert(strcmp(frame.rows[1], clockRow) == 0); // Clock survives sensor failure.

  const weather::ClockStatus unsynced[] = {
      weather::ClockStatus::Unconfigured, weather::ClockStatus::Connecting,
      weather::ClockStatus::Offline, weather::ClockStatus::Syncing};
  for (const auto status : unsynced) {
    weather::clockLine(clockRow, status, &date);
    assert(strlen(clockRow) == 16);
    assert(strstr(clockRow, "2026") == nullptr); // Never show invented time.
  }
  weather::clockLine(clockRow, weather::ClockStatus::Ready, nullptr);
  assert(strcmp(clockRow, "Clock not synced") == 0);

  setenv("TZ", config::kTimezone, 1);
  tzset();
  for (const int month : {2, 9}) {
    tm utc = {};
    utc.tm_year = 126;
    utc.tm_mon = month;
    utc.tm_mday = month == 2 ? 29 : 25;
    utc.tm_min = 59;
    time_t epoch = timegm(&utc); // 00:59 UTC, just before DST transition.
    tm local = {};
    localtime_r(&epoch, &local);
    assert(local.tm_hour == (month == 2 ? 1 : 2));
    assert(local.tm_isdst == (month == 2 ? 0 : 1));
    epoch += 60;
    localtime_r(&epoch, &local);
    assert(local.tm_hour == (month == 2 ? 3 : 2));
    assert(local.tm_min == 0);
    assert(local.tm_isdst == (month == 2 ? 1 : 0));
  }
  puts("PASS: sensor timing/recovery, LCD layout, timer rollover, clock states, Berlin DST");
}
