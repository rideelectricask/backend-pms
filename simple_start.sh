#!/bin/bash

echo "================================================"
echo "🚀 Simple Start - PMS + WAHA"
echo "================================================"
echo ""

echo "📋 This script will:"
echo "   1. Stop any existing WAHA containers"
echo "   2. Start backend (which auto-starts WAHA)"
echo "   3. Wait for services to be ready"
echo ""

read -p "Continue? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

echo ""
echo "Step 1: Cleanup existing WAHA container..."
if docker ps -a --format '{{.Names}}' | grep -q '^waha$'; then
    docker stop waha 2>/dev/null
    docker rm waha 2>/dev/null
    echo "✅ Cleanup done"
else
    echo "✅ No existing container"
fi

echo ""
echo "Step 2: Starting backend server..."
echo "   Backend will auto-start WAHA container"
echo "   This will take about 30 seconds..."
echo ""

npm run dev