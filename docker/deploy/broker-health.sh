#!/bin/sh
set -eu
# mosquitto_sub -E can exit zero even when all subscriptions are denied.
# Require the QoS-0 SUBACK explicitly; never print captured device messages or credentials.
output=$(mosquitto_sub -h "$OPENHULI_MQTT_HOST" -p 8883 \
  --cafile /run/secrets/tls_ca -V mqttv5 -d -E -W 3 \
  -i openhuli-health -u openhuli-runtime -P "$(cat /run/secrets/mqtt_password)" \
  -t 'openhuli/v1/devices/+/telemetry' 2>&1)
printf '%s\n' "$output" | grep -Eq '^Subscribed \(mid: [0-9]+\): 0$'
