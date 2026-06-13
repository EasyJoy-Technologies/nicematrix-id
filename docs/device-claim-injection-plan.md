# Logto 侧：device_ref / app_slug 注入 access token claim（B-full §3.1）

- 日期：2026-06-12
- 关联后端：`nicematrix-backend` v1.2.368（F1 backend 半已就绪，flag=off）
- 关联设计：`nicematrix-backend/docs/_plans/2026-06-12-device-session-enforcement-B-full.md`
- 状态：**设计 v2 定稿（native + web 都一等公民），实现中**
- v2 变更：放弃「native 先行 / web 仅 fail-open」。**native 与 web 都真正写入绑定 → 都签出 claim → 都受租约管控。**

## 目标
后端 `requireAuth` 的设备租约拦截（F1）只在 access token 携带**已验签**的 `device_ref`+`app_slug` claim 时生效。本变更让自编译 Logto 在签发 AT 时把这两个值作为 claim 输出，且 **refresh 续签后仍带**，对 **native（token-exchange）与 web（authorization_code）两条登录路径都生效**。

## 核心机制：grantId 绑定表（统一读，双写入点）
oidc-provider 的 RefreshToken 无 `extra`、模型 `IN_PAYLOAD` 固定 → 自定义字段不过 refresh（`act` 在 upstream 同样不过 refresh）。唯一能过 refresh 的稳定锚 = **grantId**（refresh 全程不变）。故：
- **存储**：oidc 库新增 `_nicematrix_grant_device(grant_id PK, device_ref, app_slug, created_at)`。
- **统一读**：新 producer 并入 `init.ts` 的 `extraTokenClaims`——token 是 AccessToken 时按 `token.grantId` 查表，命中→ claim `{ device_ref, app_slug }`。**对 authorization_code / refresh_token / token-exchange 所有签发类型统一生效**，故 refresh 自动带、**不触碰任何 grant 的发 token 代码**。

### 写入点（2 处，覆盖 native + web 全部 grant 创建）
| 路径 | 写入文件 | grantId 来源 | device_ref/app_slug 来源 |
|------|----------|--------------|--------------------------|
| **native**（token-exchange） | `oidc/grants/token-exchange/index.ts`（已 override） | grant 在该文件内创建 | subject-token `context`（后端 mint 时写入） |
| **web**（authorization_code，含 first-party 自动同意 + 三方手动同意） | `libraries/session/consent.ts`（新 override） | `grant.save()` 返回值 | `interactionDetails.params.device_ref/app_slug` |

> web 单点验证：`consent()` 有且仅有两个调用方——`routes/interaction/consent/index.ts`（手动）与 `middleware/koa-auto-consent.ts`（first-party 自动），二者都带 `interactionDetails`（含 params）。**覆盖 `consent()` 一处 = 覆盖 web 全部 grant 创建。**

### native 数据链（后端 → Logto）
- 后端 `social-login/lib/logto-token-exchange.js#createSubjectToken({ context })` 已支持 context → Logto `subject_tokens.context`（jsonb）。后端 3 个 native 入口（wechat/qq/alipay）mint 时传 `context:{ device_ref, app_slug }`（已在作用域内持有 `deviceRef`/`appSlug`）。
- Logto `oidc/grants/token-exchange/account.ts`（新 override）`validateSubjectToken` 的 impersonation 分支把行的 `context` 透出；grant 据此写绑定。JWT/opaque 分支无 context（服务再交换，非设备登录）→ 不写，正确。

### web 数据链（客户端 → Logto）
- web 业务 App 在 `/authorize` 带 `?device_ref=<uuid>&app_slug=<slug>`（与现有 PostSignIn webhook 同源，`interactionDetails.params`）。`consent()` 落库 grant 后写绑定。
- web App 未带 device_ref → 不写绑定 → 无 claim → 后端 fail-open 豁免（graceful；该 web App 即视为未接入设备管控，符合 ramp）。

## 改动清单
### nicematrix-id（Logto，自编译镜像）
1. **新文件** `overrides/packages/core/src/oidc/grant-device-store.ts`：`upsertGrantDevice(pool,grantId,deviceRef,appSlug)` + `findGrantDevice(pool,grantId)`，全 try-catch fail-soft，写前校验 device_ref=UUID / app_slug=slug 正则，缺任一则跳过。pool 走 `queries.pool`（`Queries.pool` 为 `public readonly`，三处调用点都能拿到，**不 override Queries.ts**）。
2. **新文件** `overrides/packages/core/src/oidc/extra-token-claims-device.ts`：`getExtraTokenClaimsForDeviceSession(queries, token)` 读 producer（仅 AccessToken + 有 grantId 时查表）。
3. 编辑 `overrides/packages/core/src/oidc/init.ts`（已 override）：`extraTokenClaims` 的 `Promise.all` 并入 device producer，merge 进返回。
4. 编辑 `overrides/packages/core/src/oidc/grants/token-exchange/index.ts`（已 override）：`grant.save()` 后 fail-soft 写绑定。
5. **新 override** `overrides/packages/core/src/oidc/grants/token-exchange/account.ts`：`validateSubjectToken` 透出 `context`。
6. **新 override** `overrides/packages/core/src/libraries/session/consent.ts`：`grant.save()` 后 fail-soft 写绑定。
7. **SQL** `deploy/sql/_nicematrix_grant_device.sql`：`CREATE TABLE IF NOT EXISTS ...`（手动 psql 应用，table-after-code）。
8. 文档：本文件 + `logto-custom/README.md`（新 override 清单）+ `docs/custom-extra-params.md`（device_ref 现多一条 AT-claim 用途）。

### nicematrix-backend（API，单独 patch + 版本号）
9. 3 个 native 入口 mint subject-token 时传 `context:{ device_ref, app_slug }`（device_ref 为空则不放）。无路由变化。

## 滚动（纯增量 + fail-soft，与 B-full §6 一致）
1. 部署带 fail-soft 代码的镜像 + 后端 patch（**表未建时：写 no-op / 读空 → 无 claim → 全豁免 → 零行为变化、零风险**）。
2. `CREATE TABLE`（claim 开始流动）。
3. 后端 `DEVICE_LEASE_ENFORCEMENT` off→shadow（观测误杀=0）→on。
- 回滚：删表（claim 停流）或镜像回退；任一步后端 flag=off = 秒级回滚。

## 自检（staging 必过，再 prod）
- native 首签 AT 带 `device_ref`+`app_slug`；**refresh 一轮后 AT 仍带**（B-full 强制项）。
- web 托管登录（带 device_ref）首签 + refresh 后 AT 都带。
- admin-console / 无 device_ref 的登录 AT **不带**（豁免靠无 claim 自动达成）。
- 表不存在时：native+web 登录全程正常、AT 无该 claim（fail-soft 验证）。
- 后端 flag=shadow→on：被踢/登出设备下一请求 401。

## 风险与门槛
- **High-risk**：自编译镜像重建 + prod-1 部署（跨境共用 Logto，prod-3 同享）+ Logto DB 加表。三者均需显式确认（AGENTS §3/§9）。
- 读路径统一、不碰 refresh/authcode grant 发 token 代码 → 核心登录路径回归面最小。
