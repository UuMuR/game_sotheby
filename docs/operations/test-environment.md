# 好友测试环境

1. 创建独立的微信云托管测试环境。
2. 创建独立 MySQL 和 Redis 实例，设置 `DATABASE_URL` 后执行 `pnpm db:migrate`。
3. 配置 `DATABASE_URL`、`REDIS_URL`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`SESSION_SECRET`。
4. 部署 `Dockerfile` 生成的服务端镜像并确认 `/health` 返回 `{ "ok": true }`。
5. 将 HTTPS/WSS 域名加入微信小程序合法域名列表。
6. 在小程序配置中切换测试 API/WSS 地址。
7. 使用体验版二维码邀请 3～8 名好友完成测试。
8. 观察服务端结构化日志、WebSocket 断线率、超时任务和异常对局。

正式图片上传 CDN 后，只修改 `services/asset-resolver.ts` 中带 `TODO(CDN_ASSET)` 的集中配置。
