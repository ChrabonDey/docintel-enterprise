FROM oven/bun:1.1.20-slim AS base
WORKDIR /app

# Install build tools and python if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency definitions
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code and frontend
COPY . .

# Build frontend production bundle
RUN bun run build:frontend

# Ensure upload directory exists
RUN mkdir -p uploads

# Expose port (default 4000 or Railway/Render dynamically assigned $PORT)
ENV PORT=4000
EXPOSE 4000

# Start server
CMD ["bun", "run", "src/server.ts"]

