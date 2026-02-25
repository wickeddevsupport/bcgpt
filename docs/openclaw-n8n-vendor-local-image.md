# OpenClaw n8n Vendor Image (Server-Side Build for Coolify)

Use this flow instead of the GitHub vendor-image workflow when you want faster and more reliable PMOS/OpenClaw deploys on your Hetzner server.

It builds the vendored n8n layer from `Dockerfile.openclaw.nx` directly on the server and stores it in Docker on that host.

## Why this setup

- Avoids flaky GitHub Actions / registry issues for the vendor image.
- Reuses Docker layer cache on your Hetzner host.
- Lets Coolify builds reference a prebuilt `N8N_VENDOR_IMAGE`.

## Script

- `scripts/coolify/build-openclaw-n8n-vendor.sh`

## Basic flow (recommended first)

Build and store the vendor image in the server's local Docker image cache:

```bash
cd /root/bcgpt
bash scripts/coolify/build-openclaw-n8n-vendor.sh
```

The script prints the exact `N8N_VENDOR_IMAGE=...` value to use in Coolify.

## Coolify configuration (PMOS/OpenClaw app)

In the PMOS/OpenClaw Dockerfile app (`Dockerfile.openclaw.nx`) build arguments, set:

```bash
INCLUDE_VENDORED_N8N=true
N8N_VENDOR_IMAGE=local/openclaw-n8n-vendor:n8n-<version>
```

Example:

```bash
INCLUDE_VENDORED_N8N=true
N8N_VENDOR_IMAGE=local/openclaw-n8n-vendor:n8n-1.76.1
```

Then restart / redeploy the app in Coolify.

## Optional: Push to a local Docker registry on the server

If your Coolify builder cannot resolve local Docker images by tag, use the same script with a local registry:

```bash
cd /root/bcgpt
bash scripts/coolify/build-openclaw-n8n-vendor.sh --push-local-registry
```

This will:

- start a local `registry:2` container on `127.0.0.1:5000` (if not already running)
- push the vendor image to that registry
- print the registry image ref for `N8N_VENDOR_IMAGE`

Example output ref:

```bash
N8N_VENDOR_IMAGE=127.0.0.1:5000/local/openclaw-n8n-vendor:n8n-1.76.1
```

## Useful options

```bash
# Build a specific n8n version
bash scripts/coolify/build-openclaw-n8n-vendor.sh --version n8n@1.78.1

# Override image tag
bash scripts/coolify/build-openclaw-n8n-vendor.sh --tag n8n-1.78.1-hotfix1

# Also tag :stable
bash scripts/coolify/build-openclaw-n8n-vendor.sh --also-tag-stable

# Just print what would be used
bash scripts/coolify/build-openclaw-n8n-vendor.sh --print-only
```

## SSH from local machine (example)

```bash
ssh -i ~/.ssh/bcgpt_hetzner deploy@<server-ip>
cd /root/bcgpt
bash scripts/coolify/build-openclaw-n8n-vendor.sh
```

## When to rebuild the vendor image

Rebuild when any of these change:

- `Dockerfile.openclaw.nx` (vendor/n8n args or build logic)
- `n8n-nodes-basecamp/` (custom n8n node code)
- desired `N8N_VERSION`

You do **not** need to rebuild the vendor image for every OpenClaw UI/backend change.
