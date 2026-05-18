FROM node:22-bookworm-slim AS build

ARG VITE_OTC_API_BASE_URL=/api
ENV VITE_OTC_API_BASE_URL=${VITE_OTC_API_BASE_URL}

WORKDIR /app

COPY . .

RUN npm install && npm run typecheck && npm run build --workspace @kaspacom/otc-web

FROM nginx:1.27-alpine

COPY apps/otc-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/otc-web/web-dist /usr/share/nginx/html

EXPOSE 8080
