#pragma once
namespace openhuli::weather {
bool validate_config();
bool begin(); // Optional service; disabled defaults perform no GPIO or network operations.
} // namespace openhuli::weather
