FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/src ./src

USER node
EXPOSE 3210
CMD ["node", "src/index.js"]
