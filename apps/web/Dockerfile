# AED Hub web app (Next.js). Build context is the repository root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://<api host> .
# NEXT_PUBLIC_API_URL is compiled into the browser bundle, so it is a build argument, not a runtime setting.
FROM node:24-bookworm-slim

ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN npm install --global pnpm@11.1.2

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @aed/web...

COPY packages/schema packages/schema
COPY apps/web apps/web

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# The build downloads the Open Sans font files once, so this step needs network access.
RUN pnpm --filter @aed/web build

ENV NODE_ENV=production
USER node
WORKDIR /app/apps/web
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node_modules/.bin/next", "start"]
