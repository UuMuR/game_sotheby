# 决战苏富比

面向微信好友小范围联机测试的在线桌游。支持 3～8 人、四阶段竞拍、五类竞拍方式、失窃藏品罚款、负债、断线重连与最终排名。

## 项目结构

- `packages/contracts`：跨端类型与消息契约
- `packages/game-engine`：纯 TypeScript 权威规则引擎
- `packages/test-bots`：固定随机种子的整局模拟器
- `apps/server`：Fastify + WebSocket 服务端
- `apps/miniprogram`：原生微信小程序
- `docs`：规则、设计、实施计划与部署说明

## 快速验证

```bash
pnpm install --ignore-scripts
pnpm verify:mvp
```

本地 MySQL/Redis 可通过 `pnpm dev:deps` 启动；需要 Docker Desktop。详细步骤见 `docs/operations/local-development.md`。

## 当前素材

首版使用本地占位图片。正式图片上传 CDN 后，只需修改 `apps/miniprogram/miniprogram/services/asset-resolver.ts` 中标有 `TODO(CDN_ASSET)` 的集中配置。
