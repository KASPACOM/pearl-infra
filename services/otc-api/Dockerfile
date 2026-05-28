FROM node:22-bookworm-slim

WORKDIR /app

COPY . .

RUN npm install && npm run typecheck

EXPOSE 8080

CMD ["npm", "--workspace", "@kaspacom/otc-api", "start"]
