#pragma once
#include <cctype>
#include <cstring>
#include <driver/gpio.h>
namespace openhuli {
inline bool safe_pin(int pin, bool output) {
  return ((pin >= 1 && pin <= 18) || pin == 21 || (pin >= 33 && pin <= 44)) &&
         (output ? GPIO_IS_VALID_OUTPUT_GPIO(pin) : GPIO_IS_VALID_GPIO(pin));
}
inline bool safe_host(const char* host) {
  const size_t length = std::strlen(host);
  if (!length || length > 253)
    return false;
  for (const char* c = host; *c; ++c)
    if (!(std::isalnum(static_cast<unsigned char>(*c)) || *c == '.' || *c == '-'))
      return false;
  return true;
}
inline bool safe_token(const char* token) {
  if (std::strncmp(token, "ohd1.", 5) || std::strlen(token) > 2048)
    return false;
  for (const char* c = token; *c; ++c)
    if (!(std::isalnum(static_cast<unsigned char>(*c)) || *c == '.' || *c == '_' || *c == '-'))
      return false;
  return true;
}
} // namespace openhuli
