#!/usr/bin/env bash
# Run this ON THE VPS: bash set-mirofish-keys.sh
# It updates the .env file with your real keys and restarts MiroFish.
set -euo pipefail

read -rp "Groq API key (https://console.groq.com → API Keys): " GROQ_KEY
read -rp "Zep  API key (https://app.getzep.com → Project → API Key): " ZEP_KEY

ENV=/opt/mirofish/.env
sed -i "s|LLM_API_KEY=.*|LLM_API_KEY=${GROQ_KEY}|" "$ENV"
sed -i "s|ZEP_API_KEY=.*|ZEP_API_KEY=${ZEP_KEY}|"  "$ENV"

echo ""
echo "Keys written to $ENV"
echo ""

cd /opt/mirofish
docker compose up -d --force-recreate
echo "Waiting for backend..."
sleep 8
curl -sf http://localhost:5001/api/graph/project/list && echo "API OK — ready for bootstrap!"
