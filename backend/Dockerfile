FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ ./src/

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 8080
CMD ["bun", "src/server.ts"]
