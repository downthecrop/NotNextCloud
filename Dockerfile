FROM node:20-slim AS web-build
WORKDIR /app
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build

FROM node:20-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev
COPY server ./server
COPY config.json ./config.json
COPY --from=web-build /app/web/dist ./web/dist
RUN mkdir -p /app/data /app/test-data

EXPOSE 4170
CMD ["node", "server/server.js"]
