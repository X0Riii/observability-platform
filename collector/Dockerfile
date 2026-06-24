FROM node:22-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-slim
RUN npx playwright install --with-deps chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    zstd \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
