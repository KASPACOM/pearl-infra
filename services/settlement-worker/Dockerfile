FROM node:22-bookworm-slim

WORKDIR /app

COPY . .

RUN npm install && npm run typecheck

VOLUME ["/data"]

CMD ["npm", "--workspace", "@kaspacom/settlement-worker", "start"]
