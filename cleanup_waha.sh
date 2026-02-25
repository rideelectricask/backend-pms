#!/bin/bash

echo "================================================"
echo "WAHA Cleanup Script"
echo "================================================"
echo ""

echo "🔍 Memeriksa container WAHA..."
if docker ps -a --format '{{.Names}}' | grep -q '^waha$'; then
    echo "📦 Container WAHA ditemukan"
    echo ""
    
    if docker ps --format '{{.Names}}' | grep -q '^waha$'; then
        echo "🛑 Menghentikan container WAHA..."
        docker stop waha
        echo "✅ Container dihentikan"
    else
        echo "ℹ️  Container sudah dalam status stopped"
    fi
    
    echo "🗑️  Menghapus container WAHA..."
    docker rm waha
    echo "✅ Container dihapus"
else
    echo "ℹ️  Container WAHA tidak ditemukan"
fi

echo ""
echo "🧹 Cleanup selesai!"
echo ""
echo "Sekarang Anda bisa menjalankan:"
echo "  bash setup_waha.sh"
echo ""