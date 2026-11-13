FROM oven/bun:1-debian AS base
WORKDIR /app

# Copy dependency definitions
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy source code and frontend
COPY . .

# Build frontend production bundle
RUN bun run build:frontend

# Ensure upload directory exists
RUN mkdir -p uploads

# Expose port (default 4000 or dynamically assigned $PORT)
ENV PORT=4000
EXPOSE 4000

# Start server
CMD ["bun", "run", "src/server.ts"]


