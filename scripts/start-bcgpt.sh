#!/bin/bash
sudo docker rm -f bcgptapi-bcgpt-1 2>/dev/null
sudo docker run -d --name bcgptapi-bcgpt-1 --restart=unless-stopped \
  -v bcgpt-data:/data \
  --network coolify \
  -l 'traefik.enable=true' \
  -l 'traefik.docker.network=coolify' \
  -l 'traefik.http.routers.bcgpt.rule=Host(`bcgpt.wickedlab.io`)' \
  -l 'traefik.http.routers.bcgpt.entrypoints=http,https' \
  -l 'traefik.http.routers.bcgpt.tls=true' \
  -l 'traefik.http.routers.bcgpt.tls.certresolver=letsencrypt' \
  -l 'traefik.http.services.bcgpt.loadbalancer.server.port=10000' \
  -e OTP_SECRET=ac28e03de88f2433a367e810a302d7695b4bc690872dc9c360a956c2e40b1383 \
  -e BASECAMP_CLIENT_ID=bef6feca339ce94f907b2dd8c3dd72e048acd9d4 \
  -e BASECAMP_CLIENT_SECRET=067156375b08398f383799bc2c1bc9feb5e16907 \
  -e BASECAMP_DEFAULT_ACCOUNT_ID=5282924 \
  -e APP_BASE_URL=https://bcgpt.wickedlab.io \
  -e PORT=10000 \
  -e 'DATABASE_URL=postgresql://bcgpt:RZ5m7nQxW4vK8dY2tL9p@bcgpt-postgres:5432/bcgpt' \
  -e SQLITE_PATH=/data/bcgpt.sqlite \
  -e ACTIVEPIECES_URL=https://flow.wickedlab.io \
  -e ACTIVEPIECES_API_KEY=ap_fmeLRfVrVbKcqqC_8v2AeVvzBefgwvFv9P7E-7fpNG4 \
  bcgptapi-bcgpt:latest

sudo docker network connect bcgptapi_default bcgptapi-bcgpt-1 2>/dev/null || true
echo "Container started"
