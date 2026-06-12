---
description: 构建镜像并用 docker compose 重新部署
allowed-tools: Bash(docker build:*), Bash(docker compose:*)
---

按原样执行以下命令（不要修改参数），构建镜像并重新部署：

```
docker build --network host -t ghcr.io/abowloflrf/agent-chat-lab:main . ;docker compose up -d
```

执行完成后报告构建与容器启动结果。
