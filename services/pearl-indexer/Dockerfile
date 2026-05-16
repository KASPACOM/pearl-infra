FROM node:22-bookworm-slim

WORKDIR /app

COPY . .

RUN npm ci && npm run typecheck

CMD ["npm", "--workspace", "@kaspacom/pearl-indexer-service", "start"]
