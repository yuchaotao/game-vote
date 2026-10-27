# One image for both the web app and the worker.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
# Sub-path to serve under (e.g. /game-vote); baked in at build time.
ARG BASE_PATH=""
ENV NEXT_TELEMETRY_DISABLED=1 BASE_PATH=${BASE_PATH}
RUN npx prisma generate && npm run build

FROM base AS runner
# next start re-reads next.config.ts, so the base path must match the build.
ARG BASE_PATH=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 BASE_PATH=${BASE_PATH}
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
