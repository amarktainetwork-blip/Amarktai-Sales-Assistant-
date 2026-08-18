FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates cron \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN chmod +x scripts/run-genie-health-check.sh && pnpm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
