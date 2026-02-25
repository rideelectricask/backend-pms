#!/bin/bash

echo "================================================"
echo "🔍 Service Status Checker"
echo "================================================"
echo ""

echo "1️⃣  Checking Backend Server (port 5000)..."
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "✅ Backend server is running on port 5000"
    PID=$(lsof -Pi :5000 -sTCP:LISTEN -t)
    echo "   PID: $PID"
else
    echo "❌ Backend server is NOT running on port 5000"
    echo "   Action: Run 'npm run dev' in backend-pms folder"
fi
echo ""

echo "2️⃣  Checking Frontend Server (port 5173)..."
if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "✅ Frontend server is running on port 5173"
    PID=$(lsof -Pi :5173 -sTCP:LISTEN -t)
    echo "   PID: $PID"
else
    echo "❌ Frontend server is NOT running on port 5173"
    echo "   Action: Run 'npm run dev' in frontend folder"
fi
echo ""

echo "3️⃣  Checking WAHA Container..."
if docker ps --format '{{.Names}}' | grep -q '^waha$'; then
    echo "✅ WAHA container is running"
    echo "   Container: waha"
    echo "   Port: 5001 (internal)"
    
    echo ""
    echo "   📊 WAHA Logs (last 5 lines):"
    docker logs waha --tail 5 2>&1 | sed 's/^/      /'
else
    echo "❌ WAHA container is NOT running"
    echo "   Action: Backend should auto-start it, or run:"
    echo "   bash setup_waha.sh"
fi
echo ""

echo "4️⃣  Testing Backend Health Endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:5000/api/health 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ Backend health endpoint is accessible"
    echo "   Response:"
    echo "$HEALTH_RESPONSE" | sed 's/^/      /'
else
    echo "❌ Cannot connect to backend health endpoint"
    echo "   Error: $HEALTH_RESPONSE"
fi
echo ""

echo "5️⃣  Testing WAHA Proxy..."
WAHA_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/waha/dashboard 2>&1)
if [ "$WAHA_RESPONSE" == "200" ]; then
    echo "✅ WAHA proxy is working (HTTP $WAHA_RESPONSE)"
elif [ "$WAHA_RESPONSE" == "302" ] || [ "$WAHA_RESPONSE" == "301" ]; then
    echo "✅ WAHA proxy is working (HTTP $WAHA_RESPONSE - Redirect)"
else
    echo "❌ WAHA proxy returned HTTP $WAHA_RESPONSE"
fi
echo ""

echo "================================================"
echo "📋 Summary"
echo "================================================"

ALL_OK=true

if ! lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    ALL_OK=false
    echo "❌ Backend NOT running → npm run dev (in backend-pms)"
fi

if ! lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    ALL_OK=false
    echo "❌ Frontend NOT running → npm run dev (in frontend)"
fi

if ! docker ps --format '{{.Names}}' | grep -q '^waha$'; then
    ALL_OK=false
    echo "❌ WAHA NOT running → bash setup_waha.sh"
fi

if [ "$ALL_OK" = true ]; then
    echo "✅ All services are running!"
    echo ""
    echo "Access your app at:"
    echo "   Frontend: http://localhost:5173"
    echo "   Backend:  http://localhost:5000"
    echo "   WAHA:     http://localhost:5000/waha/dashboard"
fi

echo ""
echo "================================================"