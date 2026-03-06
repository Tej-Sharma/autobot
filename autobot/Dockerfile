FROM node:20-bullseye AS base
WORKDIR /app

COPY autobot/package.json autobot/package-lock.json* autobot/tsconfig.json ./

RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

RUN npx playwright install --with-deps chromium

COPY autobot/src ./src

RUN npm run build

FROM node:20-bullseye
WORKDIR /app

COPY --from=base /app /app

ENV NODE_ENV=production
ENV ARTIFACT_ROOT=/app/artifacts

RUN mkdir -p /app/artifacts

EXPOSE 4000

CMD ["node", "dist/server.js"]
