FROM node:22-bookworm-slim AS ui-build
WORKDIR /app/ops-ui
COPY ops-ui/package.json ops-ui/package-lock.json ./
RUN npm ci
COPY ops-ui ./
RUN npm run build

FROM node:22-bookworm-slim AS mini-build
WORKDIR /app/mini-app
COPY mini-app/package.json mini-app/package-lock.json ./
RUN npm ci
COPY mini-app ./
COPY --from=ui-build /app/ops-ui/public/assets/milky-way-gaia-4k.webp /app/ops-ui/public/assets/SKY-CREDITS.md /app/ops-ui/public/assets/
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY server/src ./src
COPY shared /app/shared
COPY --from=ui-build /app/ops-ui/dist ./public/ops
COPY --from=mini-build /app/mini-app/dist ./public/mini

# Docker copies this ownership into a newly created named volume, letting the
# unprivileged server process persist private attachments without running as root.
RUN mkdir -p /srv/jarvis/documents && chown -R node:node /srv/jarvis

USER node
EXPOSE 3210
CMD ["node", "src/index.js"]
