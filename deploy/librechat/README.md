# LibreChat Deployment Notes

This stack is intended to run beside PMOS and point at the PMOS OpenAI-compatible gateway endpoints.

Required environment variables:

- `LIBRECHAT_HOST`
- `LIBRECHAT_URL`
- `OPENCLAW_API_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `MEILI_MASTER_KEY`
- `LIBRECHAT_JWT_SECRET`
- `LIBRECHAT_JWT_REFRESH_SECRET`
- `LIBRECHAT_CREDS_KEY`
- `LIBRECHAT_CREDS_IV`

Recommended values for the Diwakar deployment:

- `LIBRECHAT_HOST=diwakar-chat.ops.wickedlab.io`
- `LIBRECHAT_URL=https://diwakar-chat.ops.wickedlab.io`
- `OPENCLAW_API_BASE_URL=https://diwakar.ops.wickedlab.io/v1`
