FROM node:22-slim AS build
WORKDIR /app
COPY package.json tsconfig.json vite.config.ts ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
