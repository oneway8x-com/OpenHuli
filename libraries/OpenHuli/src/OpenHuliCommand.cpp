#include "OpenHuliProtocol.h"
#include <ArduinoJson.h>
#include <cstring>
namespace openhuli {
namespace device {
namespace {
const char* string_value(JsonVariantConst value) {
  if (!value.is<const char*>())
    return nullptr;
  const JsonString text = value.as<JsonString>();
  return text.c_str() && std::strlen(text.c_str()) == text.size() ? text.c_str() : nullptr;
}
} // namespace
bool parse_command(char* json, size_t length, const char* device_id, Command& out) {
  out = Command{};
  if (!json || !length || length > command_bytes || !valid_id(device_id))
    return false;
  if (std::memchr(json, '\0', length))
    return false;
  // ArduinoJson stops at the closing object. Require exactly one complete JSON object,
  // with only JSON whitespace after it, before decoding the command fields.
  size_t depth = 0;
  bool quoted = false, escaped = false, complete = false;
  for (size_t i = 0; i < length; ++i) {
    const char c = json[i];
    const bool space = c == ' ' || c == '\t' || c == '\r' || c == '\n';
    if (complete) {
      if (!space)
        return false;
      continue;
    }
    if (quoted) {
      if (escaped)
        escaped = false;
      else if (c == '\\')
        escaped = true;
      else if (c == '\"')
        quoted = false;
    } else if (c == '\"') {
      if (!depth)
        return false;
      quoted = true;
    } else if (c == '{' || c == '[') {
      if (!depth && c != '{')
        return false;
      if (++depth > 4)
        return false;
    } else if (c == '}' || c == ']') {
      if (!depth)
        return false;
      complete = --depth == 0;
    } else if (!depth && !space)
      return false;
  }
  if (!complete || quoted)
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
} // namespace device
} // namespace openhuli
