# Logto 自定义 ExtraParams：device_ref / app_slug / native_caps / native_scheme / region

## 改动目的

让 Logto PostSignIn Webhook 携带 `deviceRef`、`appSlug` 与 `region`，后端据此执行登录设备数量控制 + **按区自筛**。

`region`（取值 `intl` | `cn`）由客户端按自身构建包 / 所连 API base 自报。跨区设计（`nicematrix-backend/docs/_plans/2026-06-04_cross-region-coordination-and-device-routing.md` §6）下，**同一个 PostSignIn 事件会被 fan-out 到两个区的 webhook（prod-1 + prod-3）**，每个后端只处理 `region` 等于本区的事件，其余 `200 ignored`。`region` 缺省（老客户端）按 `intl` 处理（历史单 hook 行为）。

> `native_caps` / `native_scheme` 为 Phase B 原生社交接管参数（见 `packages/experience/src/utils/native-caps.ts`），与本文同属 ExtraParams 链路，一并维护。

## 改动文件（6 个）

所有改动标记 `[NiceMatrix]` 注释，升级时搜索 `grep -rn "\[NiceMatrix\]" logto-custom/overrides/`。

| # | 文件 | 改动 |
|---|------|------|
| 1 | `packages/schemas/src/consts/oidc.ts` | ExtraParamsKey 枚举 + zod guard + 类型定义加 `DeviceRef`、`AppSlug`、`NativeCaps`、`NativeScheme`、`Region` |
| 2 | `packages/schemas/src/types/hook.ts` | `InteractionApiMetadata` 和 `InteractionApiContextPayload` 加 `deviceRef?`、`appSlug?`、`region?` |
| 3 | `packages/core/src/libraries/hook/context-manager.ts` | `InteractionHookMetadata` 加 `deviceRef?`、`appSlug?`、`region?` |
| 4 | `packages/core/src/libraries/hook/index.ts` | 解构 metadata 时加 `deviceRef`、`appSlug`、`region`，写入 payload |
| 5 | `packages/core/src/routes/experience/middleware/koa-experience-interaction-hooks.ts` | 从 `interactionDetails.params` 提取 `device_ref`、`app_slug`、`region` |
| 6 | `packages/core/src/routes/interaction/middleware/koa-interaction-hooks.ts` | 同上（旧版 interaction 路由） |

> 注：`region` 与 `device_ref` 一样**只经 `interactionDetails.params` 流向 webhook**，不需要进入 `/sign-in?...` 的 SPA URL，因此 **`core/src/oidc/utils.ts` 的 `buildLoginPromptUrl()` 无需为 `region` 增加 `appendExtraParam`**（那里只为需要被 experience SPA 读到的参数追加，例如 `native_caps`/`native_scheme`/`app_slug`）。`extraParams: Object.values(ExtraParamsKey)`（`core/src/oidc/init.ts`）会自动登记新枚举值，OIDC 层零额外改动。

## 数据流

```
OIDC 授权请求 ?device_ref=UUID&app_slug=my-app&region=cn
  → interactionDetails.params.device_ref / .app_slug / .region
  → interactionApiMetadata.deviceRef / .appSlug / .region
  → InteractionHookContextManager.metadata
  → triggerInteractionHooks → webhook payload { deviceRef, appSlug, region }
  → fan-out 到所有已启用 PostSignIn hook：
      • POST https://api.nicematrix.com/v1/webhook/logto      (prod-1, 处理 region=intl)
      • POST https://apiv3.ej-mobile.cn/v1/webhook/logto      (prod-3, 处理 region=cn；S3c 待 cn 上托管登录时注册激活)
  → 各后端按 region 自筛：非本区 200 ignored，本区跑 applyDeviceLoginControl
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

### 第二个 cn webhook（S3c，按需激活）

当 cn（prod-3）真正启用托管登录（邮箱/短信/social-web）时，再在 **同一 Logto（跨境共用 `id.nicematrix.com`）** 注册第二个 PostSignIn hook：

- 事件: `PostSignIn`
- 地址: `https://apiv3.ej-mobile.cn/v1/webhook/logto`
- 签名密钥: prod-3 `/etc/nicematrix/backend.env` → `LOGTO_WEBHOOK_SIGNING_KEY`（已配）
- 与现有 prod-1 hook **各自独立 signingKey、互不影响**（引擎层 fan-out 原生支持，见 `libraries/hook/index.ts`）。

今天 cn = 100% native（prod-3 本地强制 `applyNativeLoginControl`），托管登录仅 intl 走现有单 prod-1 hook，故第二个 hook **暂不注册**；`region` 参数与后端自筛已提前就位（模型先立）。
