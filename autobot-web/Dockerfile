FROM node:20-bullseye AS base
WORKDIR /app

COPY package.json package-lock.json* tsconfig.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY public ./public
COPY src ./src

RUN npm run build

FROM node:20-bullseye
WORKDIR /app

COPY --from=base /app /app

EXPOSE 4173

CMD ["node", "dist/server.js"]
