# autobot-agent: runs inside each per-user Fly Machine
# Contains: Node.js, Git, Docker Engine, Playwright Chromium

# ---- Build stage ----
FROM node:20-bullseye AS build

WORKDIR /agent
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc -p tsconfig.json

# ---- Production stage ----
FROM node:20-bullseye

# Install system deps: git, Docker CLI, and Playwright browser deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bullseye stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       docker-ce-cli \
       docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright Chromium with dependencies
RUN npx playwright install --with-deps chromium

# Package managers for user projects (installRunner.ts calls yarn/pnpm/bun directly)
RUN npm install -g yarn pnpm && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# AI testing tools: Claude CLI (+ agent-browser) and tsx for running generated scripts
RUN npm install -g @anthropic-ai/claude-code tsx

WORKDIR /agent
COPY --from=build /agent/dist dist/
COPY --from=build /agent/node_modules node_modules/
COPY --from=build /agent/package.json .

# Create workspace directory (will be mounted as Fly volume)
RUN mkdir -p /workspace

ENV NODE_ENV=production
ENV PORT=8080
# Let generated Playwright scripts import @playwright/test from /agent/node_modules
ENV NODE_PATH="/agent/node_modules"

EXPOSE 8080

CMD ["node", "dist/server.js"]
