#!/bin/bash

echo "================================================"
echo "🚀 PMS + WAHA Quick Start"
echo "================================================"
echo ""

echo "Step 1: Cleanup container WAHA lama..."
bash cleanup_waha.sh

echo ""
echo "Step 2: Memeriksa npm dependencies..."
if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm packages..."
    npm install
else
    echo "✅ Dependencies sudah terinstall"
fi

echo ""
echo "Step 3: Setup WAHA (jika belum)..."
if [ ! -f "waha/.env" ]; then
    bash setup_waha.sh
else
    echo "✅ WAHA sudah dikonfigurasi"
    echo "ℹ️  Credentials ada di waha/.env"
    
    docker run -d \
        --env-file "$(pwd)/waha/.env" \
        -v "$(pwd)/waha/sessions:/app/.sessions" \
        -p 5001:3000 \
        --name waha \
        --restart unless-stopped \
        devlikeapro/waha 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ WAHA container started"
    fi
fi

echo ""
echo "================================================"
echo "✅ Setup selesai!"
echo "================================================"
echo ""
echo "Jalankan server dengan:"
echo "  npm start"
echo ""
echo "Atau jalankan langsung:"
read -p "Jalankan server sekarang? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm start
fi