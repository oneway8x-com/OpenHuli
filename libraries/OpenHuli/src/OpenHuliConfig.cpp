#include "OpenHuli.h"
#include <cstring>
namespace openhuli {
namespace {
bool bounded(const char* text, size_t minimum, size_t maximum) {
  if (!text)
    return false;
  size_t length = 0;
  while (length <= maximum && text[length]) {
    const unsigned char c = text[length++];
    if (c < 33 || c > 126)
      return false;
  }
  return length >= minimum && length <= maximum;
}
} // namespace
bool valid_config(const ClientConfig& c) {
  if (!device::valid_id(c.device_id) || !device::valid_id(c.firmware_version) ||
      !bounded(c.mqtt_host, 1, 253) || !c.mqtt_port || c.mqtt_port > 65535 ||
      !bounded(c.mqtt_username, 6, 512) || std::strncmp(c.mqtt_username, "ohm1.", 5) ||
      !bounded(c.mqtt_client_id, 16, 79) ||
      std::strncmp(c.mqtt_client_id, "openhuli-device-", 15) || !bounded(c.mqtt_token, 1, 1024) ||
      !c.root_ca || !std::strstr(c.root_ca, "-----BEGIN CERTIFICATE-----") ||
      !device::valid_capabilities(c.capabilities) || c.previous_boot_until < 0 ||
      c.previous_boot_until >= 4102444800000LL ||
      (c.capabilities.display_characters && (!c.display || !c.reserve)))
    return false;
  for (const char* p = c.mqtt_host; *p; ++p)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') ||
          *p == '.' || *p == '-'))
      return false;
  return true;
}
} // namespace openhuli
