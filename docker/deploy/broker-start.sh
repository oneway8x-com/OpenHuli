#!/bin/sh
set -eu
OPENHULI_MQTT_AUTH_TOKEN=$(cat /run/secrets/mqtt_auth_token)
export OPENHULI_MQTT_AUTH_TOKEN
chown mosquitto:mosquitto /mosquitto/data
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
