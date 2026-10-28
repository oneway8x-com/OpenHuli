#pragma once
#include "weather_core.h"
namespace openhuli::weather {
// Mutable bounded storage permits zero-copy parsing; all accepted fields are copied into Command.
bool parse_command(char* json, size_t length, const char* device_id, Command& out);
} // namespace openhuli::weather
