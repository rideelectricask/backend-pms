#!/bin/bash

echo "================================================"
echo "🔧 Connection Fix Script"
echo "================================================"
echo ""

echo "Step 1: Checking if backend is running..."
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "✅ Backend is running"
else
    echo "❌ Backend is NOT running"
    echo ""
    read -p "Start backend now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🚀 Starting backend..."
        cd "$(dirname "$0")" || exit
        npm run dev &
        sleep 5
    else
        echo "Please start backend manually: npm run dev"
        exit 1
    fi
fi
echo ""

echo "Step 2: WAHA will be auto-started by backend..."
echo "ℹ️  Backend (index.js) will handle WAHA container startup"
echo ""

echo "Step 3: Waiting for services to be ready..."
echo "⏳ Waiting 10 seconds for WAHA to fully start..."
for i in {10..1}; do
    echo -ne "   $i seconds remaining...\r"
    sleep 1
done
echo ""
echo ""

echo "Step 4: Testing connections..."
echo ""

echo "Testing backend health..."
HEALTH=$(curl -s http://localhost:5000/api/health)
if [ $? -eq 0 ]; then
    echo "✅ Backend health OK"
    echo "$HEALTH"
else
    echo "❌ Backend health FAILED"
fi
echo ""

echo "Testing WAHA proxy..."
WAHA_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/waha/dashboard)
if [ "$WAHA_CODE" == "200" ] || [ "$WAHA_CODE" == "302" ]; then
    echo "✅ WAHA proxy OK (HTTP $WAHA_CODE)"
else
    echo "❌ WAHA proxy FAILED (HTTP $WAHA_CODE)"
fi
echo ""

echo "================================================"
echo "✅ Connection fix completed!"
echo "================================================"
echo ""
echo "Now open your browser:"
echo "  http://localhost:5173/driver-management/message-dispatcher"
echo ""
echo "If still having issues, check logs:"
echo "  Backend: Check terminal where 'npm run dev' is running"
echo "  WAHA:    docker logs waha"
echo ""