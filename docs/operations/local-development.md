# 本地开发

## 前置条件

- Node.js 22 或更高版本
- pnpm 11
- Docker Desktop（运行 MySQL 与 Redis 时需要）
- 微信开发者工具

## 安装与验证

```bash
pnpm install --ignore-scripts
pnpm verify:mvp
```

## 本地基础设施

复制 `.env.example` 为 `.env`，填写微信测试 AppID 与密钥。启动依赖：

```bash
pnpm dev:deps
```

当前执行环境没有 Docker，因此仓库内的 MySQL/Redis 容器集成测试须在开发者机器或 CI 中运行。纯规则、HTTP、WebSocket、恢复语义和小程序 ViewModel 测试不依赖 Docker。

## 启动服务端

```bash
pnpm --filter @sotheby/server start
```

小程序开发阶段将 `apps/miniprogram/miniprogram/config.ts` 的 API 地址改为本机局域网 HTTPS/WSS 调试地址；正式环境从构建环境注入，不得提交密钥。
