#!/bin/bash

# Script untuk Install Docker di Linux (Ubuntu/Debian)
# Berdasarkan dokumentasi resmi Docker

echo "================================================"
echo "Docker Installation Script untuk Linux"
echo "================================================"
echo ""

# Deteksi OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
    echo "Sistem Operasi terdeteksi: $OS $VER"
else
    echo "❌ Tidak dapat mendeteksi sistem operasi"
    exit 1
fi

echo ""
echo "⚠️  Script ini akan menginstall Docker Engine"
echo "Proses ini membutuhkan sudo privileges"
echo ""
read -p "Lanjutkan? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Instalasi dibatalkan"
    exit 1
fi

echo ""
echo "Step 1: Update package index..."
sudo apt-get update

echo ""
echo "Step 2: Install dependencies..."
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

echo ""
echo "Step 3: Add Docker's official GPG key..."
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/$OS/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo ""
echo "Step 4: Setup Docker repository..."
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

echo ""
echo "Step 5: Update package index lagi..."
sudo apt-get update

echo ""
echo "Step 6: Install Docker Engine..."
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ""
echo "Step 7: Verifikasi instalasi..."
if sudo docker run hello-world; then
    echo ""
    echo "✅ Docker berhasil diinstall!"
else
    echo ""
    echo "❌ Ada masalah saat verifikasi Docker"
    exit 1
fi

echo ""
echo "Step 8: Setup Docker untuk user non-root..."
echo "Menambahkan user '$USER' ke grup docker..."
sudo usermod -aG docker $USER

echo ""
echo "================================================"
echo "✅ INSTALASI DOCKER SELESAI!"
echo "================================================"
echo ""
echo "⚠️  PENTING: Logout dan login kembali atau jalankan:"
echo "    newgrp docker"
echo ""
echo "Atau restart terminal Anda untuk menggunakan Docker tanpa sudo"
echo ""
echo "Untuk memverifikasi instalasi, jalankan:"
echo "    docker --version"
echo "    docker run hello-world"
echo ""
echo "================================================"