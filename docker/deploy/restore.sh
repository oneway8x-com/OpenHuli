#!/bin/sh
# Restores only into a NEW Compose project, never over an existing volume/database.
set -eu
stack_env=${1:?Usage: COMPOSE_PROJECT_NAME=NEW_PROJECT restore.sh STACK_ENV BACKUP_DIRECTORY}
archive=${2:?Specify a backup directory}
project=${COMPOSE_PROJECT_NAME:?Set a new explicit COMPOSE_PROJECT_NAME}
case "$project" in *[!a-z0-9-]*|'') echo 'Invalid project name' >&2; exit 1;; esac
compose() { docker compose -p "$project" --env-file "$stack_env" -f docker-compose.deploy.yml "$@"; }
for volume in postgres_data mqtt_data; do
  if docker volume inspect "${project}_${volume}" >/dev/null 2>&1; then
    echo 'Refusing restore: a target data volume already exists' >&2
    exit 1
  fi
done
# Integrity verification before creating any target resource.
actual=$(cd "$archive" && openssl dgst -sha256 database.dump mqtt-data.tar.gz)
expected=$(cat "$archive/SHA256SUMS")
if [ "$actual" != "$expected" ]; then
  echo 'Backup integrity verification failed' >&2
  exit 1
fi
compose up -d --wait postgres
compose exec -T postgres pg_restore -U openhuli -d openhuli --exit-on-error < "$archive/database.dump"
compose run --rm --no-deps -T --entrypoint tar mqtt -C /mosquitto/data -xzf - < "$archive/mqtt-data.tar.gz"
printf '%s\n' 'Restored into new project. Verify the source image, then apply forward migrations and start services explicitly. Never replay uncertain writes.'
