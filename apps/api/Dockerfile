# Build + run the API (and its seed) from the monorepo root context.
FROM node:22-slim

WORKDIR /app
# Prisma's query engine needs OpenSSL at build + runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Install deps against the full workspace (lockfile-driven).
COPY . .
RUN pnpm install --frozen-lockfile

# Build the api and its workspace dependencies (core, config, pipeline),
# then generate the Prisma client and compile the app.
RUN pnpm --filter "@pathnovo/api..." build

ENV NODE_ENV=production
WORKDIR /app/apps/api

# Migrate, seed the demo pair, then start the server.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/seed.js && node dist/main.js"]
