# --- 构建阶段 ---
FROM node:24-slim AS builder

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 安装编译工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./

RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY . .

# 编译 better-sqlite3 并构建
RUN pnpm rebuild better-sqlite3 && pnpm build

# 准备 standalone 输出
RUN mkdir -p /app/.next/standalone/.next && \
    cp -r /app/.next/static /app/.next/standalone/.next/static && \
    cp -r /app/public /app/.next/standalone/public

# --- 运行阶段 ---
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 只安装运行时工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    ca-certificates \
    dnsutils \
    ethtool \
    file \
    git \
    iproute2 \
    iputils-ping \
    jq \
    less \
    lsof \
    net-tools \
    procps \
    psmisc \
    util-linux \
    wget \
    && rm -rf /var/lib/apt/lists/*

# 复制 standalone 产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/standalone/.next/static ./app/.next/static
COPY --from=builder /app/.next/standalone/public ./app/public

# 创建数据目录
RUN mkdir -p /app/workspace /app/data && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "server.js"]
