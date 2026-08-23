FROM node:22.15.0-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN chmod +x scripts/run-genie-health-check.sh \
  && pnpm run build \
  && pnpm prune --prod \
  && test ! -e node_modules/vite \
  && ! grep -F 'from "vite"' dist/_core/index.js

FROM node:22.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system amarktai && useradd --system --gid amarktai --create-home amarktai
COPY --from=build --chown=amarktai:amarktai /app/dist ./dist
COPY --from=build --chown=amarktai:amarktai /app/drizzle ./drizzle
COPY --from=build --chown=amarktai:amarktai /app/node_modules ./node_modules
COPY --from=build --chown=amarktai:amarktai /app/scripts ./scripts
COPY --from=build --chown=amarktai:amarktai /app/package.json ./package.json
RUN chmod +x /app/scripts/run-genie-health-check.sh
USER amarktai
EXPOSE 3000
CMD ["node", "dist/_core/index.js"]
