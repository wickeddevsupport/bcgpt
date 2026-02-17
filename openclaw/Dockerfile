FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
# Optionally include vendored n8n (for embedded n8n) at build time.
# Enable by passing build-arg: --build-arg INCLUDE_VENDORED_N8N=true
# Pin version with: --build-arg N8N_VERSION=n8n@1.76.1
ARG INCLUDE_VENDORED_N8N=false
ARG N8N_VERSION=n8n@1.76.1
RUN if [ "$INCLUDE_VENDORED_N8N" = "true" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git && \
      mkdir -p openclaw/vendor && \
      git clone --depth 1 --branch "$N8N_VERSION" https://github.com/n8n-io/n8n.git openclaw/vendor/n8n && \
      # Install n8n dependencies and build
      cd openclaw/vendor/n8n && corepack enable && pnpm install --frozen-lockfile && pnpm build && \
      # Install custom Basecamp node into vendored n8n
      cd /app && \
      if [ -d "n8n-nodes-basecamp" ]; then \
        cd n8n-nodes-basecamp && npm run build 2>/dev/null || true && \
        mkdir -p /app/openclaw/vendor/n8n/packages/cli/node_modules/n8n-nodes-basecamp && \
        cp -r dist package.json /app/openclaw/vendor/n8n/packages/cli/node_modules/n8n-nodes-basecamp/; \
      fi; \
    fi
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Allow non-root user to write temp files during runtime/tests.
RUN chown -R node:node /app

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
