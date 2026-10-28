#pragma once
#include "OpenHuliProtocol.h"

namespace openhuli {
struct ClientConfig {
  const char* device_id = "";
  const char* mqtt_host = "";
  unsigned mqtt_port = 8883;
  const char* mqtt_username = "";
  const char* mqtt_client_id = "";
  const char* mqtt_token = "";
  const char* root_ca = "";
  const char* firmware_version = "openhuli-client-v1";
  device::Capabilities capabilities;
  device::DisplayWrite display = nullptr;
  // Persist the greatest expiry BEFORE any effect; return false on storage failure.
  device::Reserve reserve = nullptr;
  int64_t previous_boot_until = 0;
};
bool valid_config(const ClientConfig& config);

// Single-owner API: call begin/loop/publish/end from the same task, never from a callback.
// Configuration strings must stay alive and unchanged until end(). No copy/move or offline queue.
class OpenHuliClient {
public:
  OpenHuliClient() = default;
  ~OpenHuliClient();
  OpenHuliClient(const OpenHuliClient&) = delete;
  OpenHuliClient& operator=(const OpenHuliClient&) = delete;
  bool begin(const ClientConfig& config);
  void loop();
  bool connected() const;
  int64_t now() const;
  bool publish(const device::Telemetry& sample, int64_t sampled_at);
  bool publish(device::Reading reading, int64_t sampled_at);
  void end();

private:
  struct Impl;
  Impl* impl_ = nullptr;
};
} // namespace openhuli
