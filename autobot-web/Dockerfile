FROM node:20-bullseye AS base
WORKDIR /app

COPY autobot-web/package.json autobot-web/package-lock.json* autobot-web/tsconfig.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY autobot-web/public ./public
COPY autobot-web/src ./src

RUN npm run build

FROM node:20-bullseye
WORKDIR /app

COPY --from=base /app /app

EXPOSE 4173

CMD ["node", "dist/server.js"]
