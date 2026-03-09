# Logto 自定义 ExtraParams：device_ref / app_slug

## 改动目的

让 Logto PostSignIn Webhook 携带 `deviceRef` 和 `appSlug`，后端据此执行登录设备数量控制。

## 改动文件（6 个）

所有改动标记 `[NiceMatrix]` 注释，升级时搜索 `grep -rn "\[NiceMatrix\]" logto-custom/overrides/`。

| # | 文件 | 改动 |
|---|------|------|
| 1 | `packages/schemas/src/consts/oidc.ts` | ExtraParamsKey 枚举 + zod guard + 类型定义加 `DeviceRef`、`AppSlug` |
| 2 | `packages/schemas/src/types/hook.ts` | `InteractionApiMetadata` 和 `InteractionApiContextPayload` 加 `deviceRef?`、`appSlug?` |
| 3 | `packages/core/src/libraries/hook/context-manager.ts` | `InteractionHookMetadata` 加 `deviceRef?`、`appSlug?` |
| 4 | `packages/core/src/libraries/hook/index.ts` | 解构 metadata 时加 `deviceRef`、`appSlug`，写入 payload |
| 5 | `packages/core/src/routes/experience/middleware/koa-experience-interaction-hooks.ts` | 从 `interactionDetails.params` 提取 `device_ref`、`app_slug` |
| 6 | `packages/core/src/routes/interaction/middleware/koa-interaction-hooks.ts` | 同上（旧版 interaction 路由） |

## 数据流

```
OIDC 授权请求 ?device_ref=UUID&app_slug=my-app
  → interactionDetails.params.device_ref / .app_slug
  → interactionApiMetadata.deviceRef / .appSlug
  → InteractionHookContextManager.metadata
  → triggerInteractionHooks → webhook payload { deviceRef, appSlug }
  → POST https://api.nicematrix.com/v1/webhook/logto
```

## 升级步骤

1. 更新 `logto-upstream/`
2. 对 6 个文件逐一 diff：
   ```bash
   diff logto-upstream/路径 logto-custom/overrides/路径
   ```
3. 上游有改动 → 复制新版本到 overrides → 重新加上 `[NiceMatrix]` 标记的几行
4. 上游无改动 → 无需操作
5. `cd deploy && docker compose build logto` → 重启容器

## Webhook 配置

- ID: `9aiz0tmuqb834vpu1nkcx`
- 事件: `PostSignIn`
- 地址: `https://api.nicematrix.com/v1/webhook/logto`
- 签名密钥: 后端 `.env` → `LOGTO_WEBHOOK_SIGNING_KEY`
