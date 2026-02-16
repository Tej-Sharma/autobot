FROM node:20-bullseye AS base
WORKDIR /app

COPY autobot-web/package.json autobot-web/package-lock.json* ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY autobot-web ./

RUN npm run build

FROM node:20-bullseye
WORKDIR /app

COPY --from=base /app /app

EXPOSE 4173

CMD ["npm", "run", "start"]
