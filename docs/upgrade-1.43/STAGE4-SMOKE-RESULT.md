# Stage 4 — id-staging smoke 结果（硬门禁）

**环境:** `id-staging.nicematrix.com`（本构建机，compose project `nicematrix-id`）
**镜像:** `nicematrix-logto:release-3ee76fd11ce794d60e6451250a48719e633c1c91-20260914-164319`
（= `nicematrix-logto:latest`，digest `sha256:28daec6a…`）
**回滚锚点:** `nicematrix-logto:rollback-staging-20260914-165311`（原 `d12c68dd3224`）
**执行:** 2026-09-14 —— 脚本见 `docs/upgrade-1.43/smoke/`，可重复运行

> 总计 **60 项断言全绿，0 失败**；容器 `healthy`，`server_error` = 0，无 5xx、无未捕获异常。

---

## 0. 部署与 DB 迁移

| 检查 | 结果 |
|---|---|
| `packages/core/package.json` version | `1.43.0` |
| `systems.alterationState.timestamp` | `1786431364`（= 最后一个 1.43 alteration） |
| 13 个 alteration | 全部 `up() succeeded`，无报错 |
| 新表 | `trusted_devices` / `saml_sso_connector_signing_keys` / `cimd_grant_organizations` / `cimd_grant_client_snapshots` / `cimd_*_scopes` 均已创建 |
| 新列 | `domains.verification_files` 已加 |
| **无效索引** | **0**（`pg_index.indisvalid = false` 查询为空）——所有 `CONCURRENTLY` 建索引均成功 |
| 健康检查 | `/oidc/.well-known/openid-configuration` 200、`/api/status` 204、`/oidc/jwks` 200 |

---

## 1. 托管页登录 / 注册 —— 14/14 ✅

`smoke/smoke-hosted-login.sh`。走完整真实链路：`/oidc/auth` → Experience API → `/oidc/token`。

- `/oidc/auth` → 303 进 interaction
- 密码校验 → identification
- `submit` **正确要求 MFA**（403）→ TOTP 校验通过（本地算码，Management API 预置因子）
- passkey 提示按 SIE 策略跳过 → 强制备份码生成并绑定
- `submit` → `redirectTo` → 一方应用 **consent 自动授予** → 回跳拿到 `code`
- `authorization_code` 换票：**access_token + id_token + refresh_token 三者齐全**
- 用该 refresh_token 再刷一次成功

注册链路：`new-password-identity` 校验创建成功 → identification 时按本租户 SIE 策略
正确要求补 `email` + `phone`（`verify: true`）。这一步需要真实 OTP 投递，smoke 无法完成；
**到达该策略闸口即证明注册管线本身工作正常**，不是 1.43 行为变化。

> 过程中确认的一条非回归项：`offline_access` 若请求里没带 `prompt=consent` 会被
> OIDC 规范丢弃（`check_scope.js`，v8/v9 一致）。`docs/integration/logto-sdk.md`
> 已建议客户端带 `prompt=consent`，与实测一致。

## 2 + 3. 原生社交 token-exchange 与 refresh —— 11/11 ✅

`smoke/smoke-token-exchange.sh`（本次改动风险最高的一块）。

| 用例 | 结果 |
|---|---|
| 无 `openid` / 无 `offline_access` | 响应 **与上游逐字节一致**（只有 access_token/expires_in/scope/token_type） |
| 仅 `openid` | 签发 `id_token`；**头部无 `typ`**、**载荷无 `at_hash`**（v9 契约已落地）；`aud`/`iss`/`sub` 正确 |
| 仅 `offline_access` | 签发 `refresh_token`，不签 `id_token` |
| 单 resource + 两个 scope | 两种 token 均签发；用 RT 刷新成功 |
| **双 resource** + 两个 scope | 两种 token 均签发；**用同一条 RT 分别对主 resource 和次 resource 各刷一次，`aud` 分别正确** —— 即 2026-08-06 掉登录事故场景，已修复且在 v9 下继续成立 |
| subject_token 重放 | 第一次 200、第二次 400（一次性语义保持） |
| 后端 Account 代理路径（无 resource，`scope=openid`） | 返回 **opaque** access token + id_token，长度 43，非 JWT |

## 4. Account Center 六区块 —— ✅

`smoke/smoke-ui-and-callback.sh`。以真实 account token + password verification record 调用：

| 区块 | 端点 | 结果 |
|---|---|---|
| 资料 | `GET /api/my-account` / `PATCH /api/my-account` | 200 / 200（1.43 新增的 `assertFirstPartyClient` 通过） |
| 邮箱手机 | `POST /api/verifications/verification-code` | 201 |
| 密码 | `POST /api/my-account/password` | 204 |
| 社交 | `/api/my-account/identities` 已挂载（405 = 只有 POST/DELETE）；profile 载荷含 `identities` | ✅ |
| 两步验证 | `GET /api/my-account/mfa-verifications`、`PATCH /api/my-account/mfa-settings` | 200 / 200 |
| 注销 | `GET /api/my-account/deletion-request`（NiceMatrix 自定义路由） | 200（路由确实挂上了） |

> UI 视觉层（排版/样式）需人工过一遍，脚本只覆盖 API 面。

## 5. 社交绑定回跳 —— ✅（自动化部分）

本次上游最大的行为改动：`b64d46d495` 把 SIE 与 Account Center 的 social callback URI
统一到 `/callback/:connectorId`，按 OAuth `state` 前缀路由。

| 检查 | 结果 |
|---|---|
| `state=ac_*` | 303 → `/account/callback/social/<connectorId>` ✅ |
| `state=se_*` | 落到 Experience SPA（200） ✅ |
| 未知 / 旧格式 state | 仍默认落 Experience SPA（在途请求安全） ✅ |
| QQ ICP 跳板 `id.ej-mobile.cn` | 302 **逐字保留 path+query** 回 `id.nicematrix.com`（实测新 URI 形态） ✅ |
| QQ ICP origin 是否进产物 | experience 与 account-center 两个 bundle 内均能 grep 到 `id.ej-mobile.cn` ✅ |

> 真实 QQ / 微信 / 支付宝 / Microsoft(oid) 的 OAuth 往返需要真实账号，**留人工验收**。

## 6. Webhook 实投 + 重试幂等 —— ✅

用两个真实、无副作用的生产代码端点做实投（临时 hook，事后已删除）：

| 接收端 | 返回 | 实测投递次数 | 结论 |
|---|---|---:|---|
| `api-staging/v1/sms/logto/verify-feedback`（未配签名密钥 → fail-closed 503） | **5xx** | **4**（11:05:11 / :12 / :12 / :14） | 1 次 + 3 次重试，与 1.43 契约完全一致 |
| `api-staging/v1/webhook/logto`（无签名 → 401） | **4xx** | **1** | 4xx 不重试，符合契约 |

（nginx access log 与 backend 日志双向印证；Logto 侧 `logs` 表各记一条 `TriggerHook.User.Deleted`，
状态分别为 503 / 401。）

3 个真实接收端的幂等审计见 `PREWORK.md` §1：均满足要求，**无需后端改动**。

> 顺带确认：1.43 SSRF 防护会销毁指向 special-use（私网）地址的连接，
> 因此 **webhook 目标必须是公网地址**。我们 5 个 hook 全是公网域名，不受影响。

## 7. Management API 自定义路由 —— 4/4 ✅

`smoke/smoke-mfa-neutral.sh`。

| 检查 | 结果 |
|---|---|
| `GET /api/users/by-identity`（未命中） | 404 |
| `GET /api/users/by-identity?target=evil`（allowlist） | 400 |
| `POST /api/users/:id/verification-records/assert`（伪造 recordId） | 422（不泄漏存在性） |
| 同上，缺 body | 400（koa-guard） |

即 koa 2→3 升级后，我方自定义路由的挂载顺序与 guard 行为均未受影响。

## 8. Console —— ✅

`/console`、`/sign-in`、`/account` 三个 SPA 入口跟随重定向后均返回 200 且是 SPA HTML；
`/api/.well-known/sign-in-exp` 与 `/api/.well-known/account-center` 均 200；
sign-in-exp 正常暴露 8 个社交连接器（wechat ×2 / alipay / qq / apple / google / facebook / azuread）。

> Console 内的连接器详情页（我方 `key={data.id}` 重挂载 override）需人工点一下确认。

## 9. **MFA 行为中性回归（§5）—— ✅ 决定性验证**

`smoke/smoke-mfa-neutral.sh`。新建临时用户 → token-exchange 取 account token →
`POST /api/verifications/password` 取 verification record → `POST /api/my-account/mfa-verifications`
绑定 TOTP：

```
logto_config BEFORE = {}
bind TOTP -> HTTP 204
mfa_verifications has Totp = t      <- 因子确实写进去了
logto_config AFTER  = {}            <- enabled 没被自动打开
```

即：**绑定因子只写 `mfa_verifications`，绝不触碰 `logtoConfig.mfa.enabled`** ——
1.42 `d91696c70` 引入的自动开启已被 §5 override 干净摘除，升级对两步验证口径保持中性。

产物侧交叉验证：构建出的 bundle 里 `buildUpdatedUserLogtoConfig` 仅剩 3 处 ——
函数定义、Account API `PATCH /my-account/logto-configs`（用户显式设置）、
Management API `PATCH /users/:id/logto-configs`（管理员设置）；**因子绑定路径一处不剩**。

---

## 留给人工验收的项（自动化覆盖不到）

1. Account Center 六区块的 **UI 视觉** 是否与改版前一致。
2. **真实** QQ / 微信 / 支付宝 / Microsoft(oid) 绑定回跳（需真实账号）。
3. Console 连接器详情页切换（`key={data.id}` 重挂载）。
4. Console「登录体验 → 注册与登录」保存 —— 这是本次 **退役** `custom-profile-fields`
   override 后应当由上游 `normalizeProfileFields()` 兜住的路径，值得点一次确认不再 400。

## 过程中发现、与本次升级无关的既有问题

**staging Logto 的 PostSignIn hook 指向生产后端。** `id-staging` 的唯一 hook
`9aiz0tmuqb834vpu1nkcx` 的 URL 是 `https://api.nicematrix.com/v1/webhook/logto`（生产），
且其 signing key 与生产后端 `LOGTO_WEBHOOK_SIGNING_KEY` **完全相同**（md5 一致），
所以签名校验会通过。

已定量：staging 与 prod-1 的 application id 只有 6 个重合（`admin-console` / `m-admin` /
`m-default` / Email System / OmniFire / Cloud Service），而生产后端 `applications.logto_app_id`
里**一个都没有**——因此 staging 登录事件到达生产后只会 `200 ignored (app not found)`，
**当前无实际影响**。但这依赖「id 永不碰撞」，属于 `docs/runbooks/logto-environment-isolation.md`
明确要避免的跨环境污染，且 1.43 的重试会把它从 1 次放大到最多 4 次。

建议（需单独确认，不在本次升级范围）：把该 hook 指向 `api-staging.nicematrix.com`，
并让 staging 与生产使用**不同**的 webhook signing key。已记入 `POST-UPGRADE-REVIEW.md`。
