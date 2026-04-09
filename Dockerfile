FROM node:24

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV npm_config_build_from_source=true

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  curl \
  dnsutils \
  ethtool \
  file \
  g++ \
  git \
  iproute2 \
  iputils-ping \
  jq \
  less \
  lsof \
  make \
  net-tools \
  procps \
  psmisc \
  python3 \
  util-linux \
  wget \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./

RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY . .

RUN corepack enable pnpm && pnpm rebuild better-sqlite3 && pnpm build
RUN mkdir -p /app/.next/standalone/.next
RUN cp -r /app/.next/static /app/.next/standalone/.next/static
RUN cp -r /app/public /app/.next/standalone/public

RUN mkdir -p /app/workspace /app/data && chown -R node:node /app

USER node

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", ".next/standalone/server.js"]
