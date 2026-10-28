# One reproducible artifact includes the console, runtime and migration/operator tools.
FROM node:22.19.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.26.0
WORKDIR /opt/openhuli
COPY . .
RUN pnpm install --frozen-lockfile && pnpm prisma:generate && pnpm build
# Build outputs are identical for each role. Retain the installed pnpm workspace links and Prisma tools.
FROM node:22.19.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.26.0
WORKDIR /opt/openhuli
COPY --from=build --chown=node:node /opt/openhuli /opt/openhuli
ENV NODE_ENV=production DOCKER_CONTAINER=true NEXT_TELEMETRY_DISABLED=1
USER node
ENTRYPOINT ["node", "docker/deploy/entrypoint.mjs"]
CMD ["runtime"]
