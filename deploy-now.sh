#!/bin/bash
# Quick deployment script for BCGPT server

echo "Pulling latest code..."
cd ~/bcgpt
git fetch origin
git checkout main
git pull

echo "Rebuilding Docker image..."
docker-compose -f docker-compose.bcgpt.yml build --no-cache bcgpt

echo "Restarting container..."
docker-compose -f docker-compose.bcgpt.yml up -d bcgpt

echo "Waiting for service to start..."
sleep 5

echo "Checking service health..."
curl -s https://bcgpt.wickedlab.io/health | head -50

echo "✓ Deployment complete"
