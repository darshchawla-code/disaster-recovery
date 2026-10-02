# AidAtlas public API (server/api.js). The web app itself is static (GitHub Pages) and needs no server.
# docker build -t aidatlas-api . && docker run -p 8787:8787 -v aidatlas-data:/app/server/data aidatlas-api
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY js ./js
COPY server ./server
RUN mkdir -p server/data && chown -R node:node /app
ENV PORT=8787 NODE_ENV=production
EXPOSE 8787
VOLUME ["/app/server/data"]
USER node
CMD ["node", "server/api.js"]
