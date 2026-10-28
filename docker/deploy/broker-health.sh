#!/bin/sh
set -eu
# Exit after a successful SUBACK; no fabricated telemetry or retained health packet.
exec mosquitto_sub -h "$OPENHULI_MQTT_HOST" -p 8883 \
  --cafile /run/secrets/tls_ca -V mqttv5 -E \
  -i openhuli-health -u openhuli-runtime -P "$(cat /run/secrets/mqtt_password)" \
  -t 'openhuli/v1/devices/+/telemetry'
