FROM node:18-bullseye

# Install sistem dependencies + Python3
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    wget \
    gnupg \
    curl \
    unzip \
    build-essential \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set python3 sebagai default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3 1

# Upgrade pip
RUN pip3 install --upgrade pip setuptools wheel

# Install Chrome
RUN wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy hanya package.json (abaikan lock file yang tidak sinkron)
COPY package.json ./

# Gunakan npm install --omit=dev (bukan npm ci yang butuh lock file sinkron)
RUN npm install --omit=dev

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy semua source code
COPY . .

# Buat temp directory
RUN mkdir -p /app/temp && chmod 755 /app/temp

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000
ENV CHROME_BIN=/usr/bin/google-chrome
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

CMD ["node", "index.js"]
