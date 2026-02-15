FROM node:20-bullseye AS base
WORKDIR /app

COPY package.json package-lock.json* tsconfig.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

RUN npx playwright install --with-deps chromium

COPY src ./src

RUN npm run build

FROM node:20-bullseye
WORKDIR /app

COPY --from=base /app /app

ENV NODE_ENV=production
ENV ARTIFACT_ROOT=/app/artifacts

RUN mkdir -p /app/artifacts

EXPOSE 4000

CMD ["node", "dist/server.js"]
