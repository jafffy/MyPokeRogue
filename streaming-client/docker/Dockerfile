FROM node:20-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxss1 \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Copy server package files
COPY server/package.json server/package-lock.json* ./server/

# Install dependencies
RUN cd server && npm install --production

# Copy all source files
COPY server/ ./server/
COPY client/ ./client/

WORKDIR /app/server

EXPOSE 3000

# Default environment
ENV PORT=3000
ENV GAME_URL=https://pokerogue.net
ENV CAPTURE_INTERVAL=100
ENV JPEG_QUALITY=60
ENV STREAM_WIDTH=480
ENV STREAM_HEIGHT=270

CMD ["node", "server.js"]
