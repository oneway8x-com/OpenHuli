#pragma once

#include <stdio.h>
#include <time.h>

namespace weather {
enum class ClockStatus { Unconfigured, Connecting, Offline, Syncing, Ready };

inline void clockLine(char (&line)[17], ClockStatus status, const tm* localTime) {
  if (status == ClockStatus::Ready && localTime != nullptr &&
      strftime(line, sizeof(line), "%d/%m/%Y %H:%M", localTime) == 16) {
    return;
  }
  const char* message = "Clock not synced";
  switch (status) {
  case ClockStatus::Unconfigured:
    message = "Set Wi-Fi config";
    break;
  case ClockStatus::Connecting:
    message = "Wi-Fi connecting";
    break;
  case ClockStatus::Offline:
    message = "Wi-Fi offline";
    break;
  case ClockStatus::Syncing:
    message = "Syncing time...";
    break;
  case ClockStatus::Ready:
    break;
  }
  snprintf(line, sizeof(line), "%-16s", message);
}
} // namespace weather
