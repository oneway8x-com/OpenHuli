FROM alpine:3.22 AS build
RUN apk add --no-cache build-base curl-dev mosquitto-dev
WORKDIR /build
COPY auth-bridge.c .
RUN cc -std=c11 -Wall -Wextra -Werror -fPIC -shared auth-bridge.c -lcurl -lmosquitto -o openhuli-auth.so

FROM eclipse-mosquitto:2.0.22
RUN apk add --no-cache libcurl mosquitto-libs
COPY --from=build /build/openhuli-auth.so /mosquitto/openhuli-auth.so
COPY mosquitto.conf /mosquitto/config/mosquitto.conf
