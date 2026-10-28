#include "command_json.h"
#include "voice_core.h"
#include <ArduinoJson.h>
#include <cstring>
namespace openhuli::weather {
namespace {
const char* string_value(JsonVariantConst value) {
  if (!value.is<const char*>())
    return nullptr;
  const JsonString text = value.as<JsonString>();
  return text.c_str() && std::strlen(text.c_str()) == text.size() ? text.c_str() : nullptr;
}
} // namespace
bool parse_command(char* json, size_t length, const char* device_id, Command& out) {
  if (!json || !length || length > command_bytes || !valid_id(device_id))
    return false;
  if (std::memchr(json, '\0', length))
    return false;
  StaticJsonDocument<1536> doc;
  if (deserializeJson(doc, json, length, DeserializationOption::NestingLimit(4)))
    return false;
  JsonObjectConst object = doc.as<JsonObjectConst>();
  const char *type = string_value(object["type"]), *device = string_value(object["deviceId"]);
  if (object.size() != 9 || !object["version"].is<unsigned>() ||
      object["version"].as<unsigned>() != 1 || !type || std::strcmp(type, "device.command") ||
      !device || std::strcmp(device, device_id))
    return false;
  const char *message = string_value(object["messageId"]),
             *command = string_value(object["commandId"]),
             *execution = string_value(object["executionId"]);
  if (!valid_id(message) || !valid_id(command) || !valid_id(execution) ||
      !parse_utc(string_value(object["issuedAt"]), out.issued_at) ||
      !parse_utc(string_value(object["expiresAt"]), out.expires_at))
    return false;
  std::strcpy(out.message_id, message);
  std::strcpy(out.command_id, command);
  std::strcpy(out.execution_id, execution);
  JsonObjectConst action = object["action"].as<JsonObjectConst>();
  const char* kind = string_value(action["kind"]);
  if (!kind)
    return false;
  if (!std::strcmp(kind, "ping")) {
    out.action = Action::ping;
    return action.size() == 1;
  }
  if (std::strcmp(kind, "display.write") || action.size() != 2 || !string_value(action["text"]))
    return false;
  out.action = Action::display;
  const auto text = action["text"].as<JsonString>();
  if (!text.size() || text.size() > 2048)
    return false;
  out.text_supported = text.size() <= display_limit;
  for (size_t i = 0; i < text.size(); ++i)
    if (static_cast<unsigned char>(text.c_str()[i]) < 32 ||
        static_cast<unsigned char>(text.c_str()[i]) > 126)
      out.text_supported = false;
  if (out.text_supported)
    std::memcpy(out.text, text.c_str(), text.size() + 1);
  return true;
}
} // namespace openhuli::weather
