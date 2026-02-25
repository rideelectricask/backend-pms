#!/bin/bash

echo "================================================"
echo "WAHA (WhatsApp HTTP API) - Setup Script"
echo "================================================"
echo ""

echo "Step 0: Memeriksa Docker..."
if ! command -v docker &> /dev/null
then
    echo "❌ Docker belum terinstal!"
    echo "Silakan install Docker terlebih dahulu:"
    echo "https://docs.docker.com/get-docker/"
    exit 1
fi
echo "✅ Docker terdeteksi"
echo ""

echo "Step 0.1: Membersihkan container WAHA lama..."
if docker ps -a --format '{{.Names}}' | grep -q '^waha$'; then
    echo "🗑️  Menghapus container WAHA lama..."
    docker stop waha 2>/dev/null
    docker rm waha 2>/dev/null
    echo "✅ Container lama dihapus"
else
    echo "ℹ️  Tidak ada container lama"
fi
echo ""

echo "Step 1: Download WAHA Docker image..."
echo "Menjalankan: docker pull devlikeapro/waha"
docker pull devlikeapro/waha
echo ""

echo "Step 2: Membuat direktori konfigurasi..."
mkdir -p waha/sessions
echo "✅ Direktori waha/sessions dibuat"
echo ""

echo "Step 3: Inisialisasi WAHA..."
if [ -f waha/.env ] && [ -s waha/.env ]; then
    echo "ℹ️  File waha/.env sudah ada, menggunakan credentials yang ada..."
else
    echo "Membuat file .env dengan credentials..."
    docker run --rm -v "$(pwd)/waha":/app/env devlikeapro/waha init-waha /app/env
fi
echo ""

if [ -f waha/.env ]; then
    echo "================================================"
    echo "📋 CREDENTIALS:"
    echo "================================================"
    
    USERNAME=$(grep WAHA_DASHBOARD_USERNAME waha/.env | cut -d '=' -f2)
    PASSWORD=$(grep WAHA_DASHBOARD_PASSWORD waha/.env | cut -d '=' -f2)
    API_KEY=$(grep WAHA_API_KEY waha/.env | cut -d '=' -f2)
    
    echo "Dashboard & Swagger:"
    echo "  - Username: $USERNAME"
    echo "  - Password: $PASSWORD"
    echo ""
    echo "API Key:"
    echo "  - $API_KEY"
    echo ""
    echo "💾 Credentials tersimpan di file waha/.env"
    echo "================================================"
    echo ""
fi

echo "Step 4: Menjalankan WAHA pada port 5001..."
echo ""
echo "WAHA akan berjalan di background"
echo "Akses melalui backend server:"
echo "  📊 Dashboard: http://localhost:5000/waha/dashboard"
echo "  📚 Swagger: http://localhost:5000/waha/"
echo ""
echo "================================================"
echo ""

docker run -d \
    --env-file "$(pwd)/waha/.env" \
    -v "$(pwd)/waha/sessions:/app/.sessions" \
    -p 5001:3000 \
    --name waha \
    --restart unless-stopped \
    devlikeapro/waha

if [ $? -eq 0 ]; then
    echo "✅ WAHA berhasil dijalankan!"
    echo ""
    echo "Untuk melihat logs:"
    echo "  docker logs -f waha"
    echo ""
    echo "Untuk menghentikan:"
    echo "  docker stop waha"
    echo ""
    echo "Untuk me-restart:"
    echo "  docker restart waha"
    echo ""
else
    echo "❌ Gagal menjalankan WAHA"
    exit 1
fi