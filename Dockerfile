FROM node:20-slim AS web-build
WORKDIR /app
COPY clients/web/package.json clients/web/package-lock.json* ./clients/web/
RUN cd clients/web && npm install
COPY clients/web ./clients/web
RUN cd clients/web && npm run build

FROM node:20-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev
COPY server ./server
COPY config.json ./config.json
COPY --from=web-build /app/clients/web/dist ./clients/web/dist
RUN mkdir -p /app/data /app/test-data

EXPOSE 4170
CMD ["node", "server/server.js"]
