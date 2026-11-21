# Mapa serc API. Build context is the repository root (the image needs packages/schema):
#   docker build -f apps/api/Dockerfile .
# Debian base on purpose: the DuckDB Node bindings ship glibc binaries.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    CI=true \
    PORT=8787 \
    DATA_DIR=/data

# The pnpm version that wrote pnpm-lock.yaml.
RUN npm install --global pnpm@11.1.2

WORKDIR /app

# Dependencies first, so this layer is rebuilt only when they change.
# pnpm-workspace.yaml carries `allowBuilds` for esbuild; without it tsx has no binary and cannot start.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @aed/api...

COPY packages/schema packages/schema
COPY apps/api apps/api

# The database and the downloaded copies of the sources live on a volume mounted here.
RUN mkdir -p /data && chown node:node /data

USER node
WORKDIR /app/apps/api
EXPOSE 8787

# The first start builds the dataset from the bundled copies of the sources, hence the start period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/server.ts"]
