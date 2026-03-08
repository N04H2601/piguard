FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY server/ server/
COPY client/ client/

RUN npm run build

FROM node:22-alpine AS production

RUN apk add --no-cache \
  procps \
  coreutils \
  iproute2 \
  iptables \
  iputils \
  wireguard-tools \
  curl \
  wget

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/

RUN mkdir -p data/geoip \
  && chown -R node:node /app/data

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3333/api/v1/health || exit 1

CMD ["node", "dist/server/index.js"]
