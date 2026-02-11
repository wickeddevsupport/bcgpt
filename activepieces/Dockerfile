FROM node:20.19-bullseye-slim AS base

# Set environment variables early for better layer caching
ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    NX_DAEMON=false \
    NX_NO_CLOUD=true

# Install all system dependencies in a single layer with cache mounts
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update -o Acquire::AllowReleaseInfoChange=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30; \
    apt-get install -y --no-install-recommends \
        openssh-client \
        python3 \
        g++ \
        build-essential \
        git \
        poppler-utils \
        poppler-data \
        procps \
        locales \
        locales-all \
        unzip \
        curl \
        ca-certificates \
        libcap-dev; \
    rm -rf /var/lib/apt/lists/*; \
    yarn config set python /usr/bin/python3

RUN export ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
      curl -fSL https://github.com/oven-sh/bun/releases/download/bun-v1.3.1/bun-linux-x64-baseline.zip -o bun.zip; \
    elif [ "$ARCH" = "aarch64" ]; then \
      curl -fSL https://github.com/oven-sh/bun/releases/download/bun-v1.3.1/bun-linux-aarch64.zip -o bun.zip; \
    fi
    
RUN unzip bun.zip \
    && mv bun-*/bun /usr/local/bin/bun \
    && chmod +x /usr/local/bin/bun \
    && rm -rf bun.zip bun-*

RUN bun --version

# Install global npm packages in a single layer
RUN --mount=type=cache,target=/root/.npm \
    npm install -g --no-fund --no-audit \
    node-gyp \
    npm@9.9.3 \
    pm2@6.0.10 \
    typescript@4.9.4

# Install isolated-vm globally (needed for sandboxes)
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd /usr/src && bun install isolated-vm@5.0.1

### STAGE 1: Build ###
FROM base AS build

WORKDIR /usr/src/app

# Copy only dependency files first for better layer caching
COPY .npmrc package.json bun.lock ./

# Remove local repo dependency that causes recursive node_modules in CI builds
RUN node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.dependencies&&j.dependencies['bcgpt-full-v3']){delete j.dependencies['bcgpt-full-v3'];fs.writeFileSync(p,JSON.stringify(j,null,2));}"

# Install all dependencies using the checked-in lockfile for faster, deterministic builds.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --no-progress

# Copy source code after dependency installation
COPY . .

# Build core projects (already has NX_NO_CLOUD from base stage)
# Run sequentially to reduce peak memory usage in CI
ENV NODE_OPTIONS=--max-old-space-size=4096

# Build server-api which includes flow-gallery
RUN npx nx build server-api --configuration production --skip-nx-cache

# Build pieces framework and common first (required dependencies for all pieces)
RUN npx nx build pieces-framework --skip-nx-cache
RUN npx nx build pieces-common --skip-nx-cache

# Build custom pieces so they can be loaded via AP_DEV_PIECES at runtime
RUN npx nx build pieces-basecamp --skip-nx-cache

# Build react-ui frontend
RUN npx nx build react-ui --configuration production --skip-nx-cache

# Install production dependencies only for the backend API
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd dist/packages/server/api && \
    bun install --production

# Preserve isolate default config before removing sources
RUN mkdir -p /usr/src/app/dist/assets && \
    cp /usr/src/app/packages/server/api/src/assets/default.cf /usr/src/app/dist/assets/default.cf

# NOTE: Avoid deleting large directories here to prevent occasional BuildKit
# finalize snapshot errors in CI.

### STAGE 2: Run ###
FROM base AS run

WORKDIR /usr/src/app

# Install Nginx and gettext in a single layer with cache mount
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update -o Acquire::AllowReleaseInfoChange=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30; \
    apt-get install -y --no-install-recommends nginx gettext; \
    rm -rf /var/lib/apt/lists/*

# Copy static configuration files first (better layer caching)
COPY nginx.react.conf /etc/nginx/nginx.conf
COPY --from=build /usr/src/app/dist/assets/default.cf /usr/local/etc/isolate
COPY docker-entrypoint.sh .

# Create all necessary directories in one layer
RUN mkdir -p \
    /usr/src/app/dist/packages/server \
    /usr/src/app/dist/packages/engine \
    /usr/src/app/dist/packages/shared && \
    # Normalize line endings (Windows checkouts can introduce CRLF which breaks shebang execution)
    sed -i 's/\r$//' docker-entrypoint.sh && \
    chmod +x docker-entrypoint.sh

# Copy built artifacts from build stage
COPY --from=build /usr/src/app/LICENSE .
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist/packages/engine/ ./dist/packages/engine/
COPY --from=build /usr/src/app/dist/packages/server/ ./dist/packages/server/
COPY --from=build /usr/src/app/dist/packages/shared/ ./dist/packages/shared/
COPY --from=build /usr/src/app/dist/packages/pieces/ ./dist/packages/pieces/
# Runtime does not require full source packages; keep image smaller and avoid deep paths

# Ensure workspace packages resolve in the runtime image (avoid broken symlinks)
RUN rm -rf node_modules/@activepieces/pieces-framework \
    node_modules/@activepieces/pieces-common \
    node_modules/@activepieces/shared && \
    mkdir -p node_modules/@activepieces/pieces-framework \
    node_modules/@activepieces/pieces-common \
    node_modules/@activepieces/shared && \
    cp -r dist/packages/pieces/community/framework/* node_modules/@activepieces/pieces-framework/ && \
    cp -r dist/packages/pieces/community/common/* node_modules/@activepieces/pieces-common/ && \
    cp -r dist/packages/shared/* node_modules/@activepieces/shared/

# Make custom pieces available at a stable path and default AP_DEV_PIECES
RUN mkdir -p /usr/src/app/custom-pieces && \
    cp -r /usr/src/app/dist/packages/pieces/community/basecamp /usr/src/app/custom-pieces/basecamp
ENV AP_DEV_PIECES="basecamp"

# Copy frontend files to Nginx document root
COPY --from=build /usr/src/app/dist/packages/react-ui /usr/share/nginx/html/

LABEL service=activepieces

ENTRYPOINT ["./docker-entrypoint.sh"]
EXPOSE 80
