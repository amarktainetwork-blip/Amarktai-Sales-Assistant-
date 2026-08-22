FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && chmod +x scripts/run-genie-health-check.sh scripts/worker-run.sh deploy/webdock/verify-production.sh deploy/webdock/backup.sh deploy/webdock/upgrade.sh deploy/webdock/rollback.sh \
  && pnpm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
