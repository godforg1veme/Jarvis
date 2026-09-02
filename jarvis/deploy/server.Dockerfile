FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY server/src ./src

# Docker copies this ownership into a newly created named volume, letting the
# unprivileged server process persist private attachments without running as root.
RUN mkdir -p /srv/jarvis/documents && chown -R node:node /srv/jarvis

USER node
EXPOSE 3210
CMD ["node", "src/index.js"]
