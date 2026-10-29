# One image for both the web app and the worker.
#
# The runtime image holds only what runs: the Next.js standalone server (with the
# node_modules it actually uses), the pre-bundled worker, the Prisma CLI for
# migrations, and the schema. Layers go from least to most often changed, so a
# typical deploy pulls only the last few.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Prisma CLI for `migrate deploy` at start-up, in its own folder: changes only
# when the Prisma version does.
FROM base AS prisma-cli
COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma.json
WORKDIR /opt/prisma-cli
RUN npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund "prisma@$(node -p "require('/tmp/prisma.json').version")" \
  && npm cache clean --force

FROM deps AS build
COPY . .
# Sub-path to serve under (e.g. /game-vote); baked in at build time.
ARG BASE_PATH=""
ENV NEXT_TELEMETRY_DISABLED=1 BASE_PATH=${BASE_PATH} NEXT_OUTPUT=standalone
RUN npx prisma generate && npm run build && npm run build:worker
# Split the standalone output so its node_modules (changes only with
# dependencies) can be its own layer.
RUN mkdir /out \
  && mv .next/standalone/node_modules /out/node_modules \
  && mv .next/standalone /out/app \
  && cp -r .next/static /out/app/.next/static \
  && cp -r dist prisma /out/app/

FROM base AS runner
ARG BASE_PATH=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 BASE_PATH=${BASE_PATH}
COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/app ./
EXPOSE 3000
# Web: apply migrations, then serve. The worker runs `node dist/worker/index.js`;
# one job now: `node dist/worker/run-once.js <name>`.
CMD ["sh", "-c", "node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy && exec node server.js"]
