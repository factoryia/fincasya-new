# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY convex ./convex

# (Opcional) Generar tipos de Convex (_generated) en CI si hay CONVEX_DEPLOYMENT
ARG CONVEX_DEPLOYMENT
ENV CONVEX_DEPLOYMENT=${CONVEX_DEPLOYMENT}
RUN sh -c 'if [ -n "$CONVEX_DEPLOYMENT" ]; then bunx convex codegen; else echo "Skipping convex codegen (no CONVEX_DEPLOYMENT)"; fi'

RUN bun run build

# Production stage
FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/convex/_generated ./convex/_generated

EXPOSE 3001

CMD ["bun", "run", "start"]
