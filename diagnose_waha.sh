#!/bin/bash

echo "================================================"
echo "🔍 WAHA Diagnostic Script"
echo "================================================"
echo ""

echo "Step 1: Checking Docker installation..."
if command -v docker &> /dev/null; then
    echo "✅ Docker is installed"
    docker --version
else
    echo "❌ Docker is NOT installed"
    echo "Please run: bash install_docker.sh"
    exit 1
fi

echo ""
echo "Step 2: Checking WAHA container status..."
CONTAINER_STATUS=$(docker ps -a --filter name=waha --format "{{.Status}}" 2>/dev/null)

if [ -z "$CONTAINER_STATUS" ]; then
    echo "❌ WAHA container does NOT exist"
    echo ""
    echo "Creating WAHA container now..."
else
    echo "Container status: $CONTAINER_STATUS"
    
    if docker ps --filter name=waha --format "{{.Names}}" | grep -q '^waha$'; then
        echo "✅ WAHA container is RUNNING"
    else
        echo "⚠️  WAHA container exists but is NOT running"
        echo ""
        echo "Removing old container..."
        docker rm waha 2>/dev/null
    fi
fi

echo ""
echo "Step 3: Checking waha/.env file..."
if [ -f "waha/.env" ]; then
    echo "✅ waha/.env file exists"
    echo ""
    echo "Credentials:"
    grep "WAHA_DASHBOARD_USERNAME" waha/.env
    grep "WAHA_DASHBOARD_PASSWORD" waha/.env | head -c 50
    echo "..."
else
    echo "❌ waha/.env file NOT found"
    echo ""
    echo "Creating waha/.env file..."
    mkdir -p waha
    docker run --rm -v "$(pwd)/waha":/app/env devlikeapro/waha init-waha /app/env
fi

echo ""
echo "Step 4: Checking port 5001 availability..."
if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port 5001 is already in use by:"
    lsof -Pi :5001 -sTCP:LISTEN
    echo ""
    echo "Killing process on port 5001..."
    lsof -Pi :5001 -sTCP:LISTEN -t | xargs kill -9 2>/dev/null
    sleep 2
else
    echo "✅ Port 5001 is available"
fi

echo ""
echo "Step 5: Starting WAHA container..."
docker pull devlikeapro/waha

mkdir -p waha/sessions

docker run -d \
    --env-file "$(pwd)/waha/.env" \
    -v "$(pwd)/waha/sessions:/app/.sessions" \
    -p 5001:3000 \
    --name waha \
    --restart unless-stopped \
    devlikeapro/waha

if [ $? -eq 0 ]; then
    echo "✅ WAHA container started"
else
    echo "❌ Failed to start WAHA container"
    exit 1
fi

echo ""
echo "Step 6: Waiting for WAHA to initialize (15 seconds)..."
for i in {15..1}; do
    echo -ne "   $i seconds remaining...\r"
    sleep 1
done
echo ""

echo ""
echo "Step 7: Checking WAHA container logs..."
echo "--- Last 20 lines ---"
docker logs waha --tail 20
echo "--- End of logs ---"

echo ""
echo "Step 8: Testing WAHA connectivity..."
sleep 2

echo "Testing port 5001..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ 2>&1)
if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "302" ] || [ "$HTTP_CODE" == "301" ]; then
    echo "✅ WAHA responds on port 5001 (HTTP $HTTP_CODE)"
else
    echo "❌ WAHA not responding on port 5001 (HTTP $HTTP_CODE)"
    echo ""
    echo "Checking logs for errors..."
    docker logs waha --tail 30
fi

echo ""
echo "Step 9: Testing backend health endpoint..."
HEALTH=$(curl -s http://localhost:5000/api/health 2>&1)
echo "$HEALTH"

echo ""
echo "================================================"
echo "📋 Summary & Next Steps"
echo "================================================"
echo ""

if docker ps --filter name=waha --format "{{.Names}}" | grep -q '^waha$'; then
    echo "✅ WAHA container is running"
    echo ""
    echo "Access WAHA at:"
    echo "  🔵 Direct:  http://localhost:5001/dashboard"
    echo "  ⚪ Proxy:   http://localhost:5000/waha/dashboard"
    echo ""
    echo "Dashboard credentials (from waha/.env):"
    grep "WAHA_DASHBOARD_USERNAME" waha/.env 2>/dev/null
    echo "  Password: Check waha/.env file"
    echo ""
    echo "Now restart your backend with: npm run dev"
else
    echo "❌ WAHA container is NOT running"
    echo ""
    echo "Check logs above for errors"
    echo "Common issues:"
    echo "  - Port 5001 already in use"
    echo "  - waha/.env file missing or corrupted"
    echo "  - Docker daemon not running"
    echo ""
    echo "To manually check logs: docker logs waha"
fi

echo ""
echo "================================================"