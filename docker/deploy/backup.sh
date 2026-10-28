#!/bin/sh
# Quiesced backup of this deployment only; no secrets/certificates are copied into the archive.
set -eu
umask 077
stack_env=${1:?Usage: backup.sh STACK_ENV NEW_BACKUP_DIRECTORY}
destination=${2:?Specify a new private backup directory}
mkdir "$destination"
compose() { docker compose --env-file "$stack_env" -f docker-compose.deploy.yml "$@"; }
compose stop app runtime mqtt
restart() { compose up -d --no-deps app runtime mqtt; }
trap restart EXIT
compose exec -T postgres pg_dump -U openhuli -d openhuli -Fc > "$destination/database.dump"
compose run --rm --no-deps -T --entrypoint tar mqtt -C /mosquitto/data -czf - . > "$destination/mqtt-data.tar.gz"
# Record artifact identity without serializing environment values or credentials.
compose images --format json > "$destination/images.json"
(cd "$destination" && openssl dgst -sha256 database.dump mqtt-data.tar.gz > SHA256SUMS)
printf '%s\n' 'Backup complete. Keep secret files and certificate recovery material separately encrypted.'
