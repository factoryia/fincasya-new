# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY convex ./convex
COPY assets/contracts ./assets/contracts

# Generar convex/_generated SIEMPRE en build (necesario para runtime).
# BuildKit secret: el deploy key no queda en capas de la imagen.
RUN --mount=type=secret,id=CONVEX_DEPLOY_KEY \
  export CONVEX_DEPLOY_KEY="$(cat /run/secrets/CONVEX_DEPLOY_KEY)" && \
  bunx convex codegen

RUN bun run build
# Fallar el build si la salida no coincide con el CMD (evita imágenes que reinician en loop).
RUN test -f dist/main.js || (echo "missing dist/main.js; dist layout:" && ls -laR dist && exit 1)

# Production stage
FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
# Usar Chromium del sistema (apk) en lugar del binario descargado por puppeteer.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/convex/_generated ./convex/_generated
COPY assets/contracts ./assets/contracts

# Menos peso en disco: sin Chromium embebido de puppeteer ni tooling de types en runtime.
RUN rm -rf /root/.cache/puppeteer node_modules/typescript node_modules/@types 2>/dev/null || true

EXPOSE 3001

# Ejecutar el bundle explícito (no depender de cómo Bun resuelva `node` en scripts npm).
CMD ["bun", "dist/main.js"]
