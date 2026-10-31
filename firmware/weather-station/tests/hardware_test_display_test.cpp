#include <assert.h>
#include <limits>
#include <stdio.h>
#include <string.h>

#include "../weather_station_test/display_state.h"

int main() {
  using hardware_test::sampleScreen;
  auto screen = hardware_test::startupScreen();
  assert(strcmp(screen.rows[0], "Weather Station ") == 0);
  assert(strcmp(screen.rows[1], "Starting...     ") == 0);
  assert(!hardware_test::readDue(1999, 0));
  assert(hardware_test::readDue(2000, 0));
  assert(!hardware_test::readDue(998, UINT32_MAX - 1000));
  assert(hardware_test::readDue(999, UINT32_MAX - 1000));

  screen = sampleScreen(23, 45);
  assert(screen.valid);
  assert(strcmp(screen.rows[0], "Temp: 23.0 C    ") == 0);
  assert(strcmp(screen.rows[1], "Humidity: 45%   ") == 0);
  const float nan = std::numeric_limits<float>::quiet_NaN();
  const float invalid[][2] = {
      {nan, 45}, {23, nan}, {23, -1}, {23, 101}, {std::numeric_limits<float>::infinity(), 45},
      {81, 45}};
  for (const auto& sample : invalid) {
    screen = sampleScreen(sample[0], sample[1]);
    assert(!screen.valid);
    assert(strcmp(screen.rows[0], "DHT11 ERROR     ") == 0);
    assert(strcmp(screen.rows[1], "Check wiring    ") == 0);
  }
  screen = sampleScreen(-40, 100);
  assert(screen.valid);
  assert(strstr(screen.rows[0], "-40.0 C") != nullptr);
  assert(strstr(screen.rows[1], "100%") != nullptr);
  screen = sampleScreen(24, 0); // Recovery also erases the longer old rows.
  assert(screen.valid);
  assert(strcmp(screen.rows[0], "Temp: 24.0 C    ") == 0);
  assert(strcmp(screen.rows[1], "Humidity: 0%    ") == 0);
  assert(strlen(screen.rows[0]) == 16 && strlen(screen.rows[1]) == 16);
  puts("PASS: startup, 2-second cadence, timer rollover, valid/error/recovery rows");
}
