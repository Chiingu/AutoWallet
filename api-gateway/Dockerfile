FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

USER node

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
