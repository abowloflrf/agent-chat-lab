# --- 构建阶段 ---
FROM node:24-slim AS builder

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 编译工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

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
    tini \
    util-linux \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Python 运行时（agent 执行代码用）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

# node 拥有的 venv（含 pip）；PATH 前置让 python/pip 默认走它，绕过 PEP 668
ENV PATH="/opt/venv/bin:$PATH"
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir \
       requests pandas openpyxl matplotlib Pillow pyyaml pypdf \
    && chown -R node:node /opt/venv

# 复制 standalone 产物
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p /app/workspace /app/data && chown node:node /app/workspace /app/data

USER node

EXPOSE 3000

# tini 作为 PID 1：回收 Bash 工具产生的孤儿/僵尸进程，并正确转发信号。
# 放在镜像里而非 compose，确保 docker run / k8s 等任意部署方式都生效。
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
