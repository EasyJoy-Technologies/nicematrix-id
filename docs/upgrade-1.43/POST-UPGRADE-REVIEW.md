# Logto 1.41.0 → 1.43.0 升级复盘

**完成时间:** 2026-09-14
**分支:** `upgrade/logto-1.43`
**镜像:** `nicematrix-logto:release-3ee76fd11ce794d60e6451250a48719e633c1c91-20260914-164319`
**方案:** `PLAN.md` · **前置核查:** `PREWORK.md` · **staging 结果:** `STAGE4-SMOKE-RESULT.md`

---

## 1. 最终状态

| 环境 | Logto | 结果 |
|---|---|---|
| id-staging | **1.43.0** | healthy，60/60 smoke 全绿 |
| prod-1（= intl + cn 两区） | **1.43.0** | healthy，关键路径回归全绿 |
| prod-3 (cn) | 无独立 Logto，跨境共用 prod-1 | 随 prod-1 一次生效 |

三台主机 `/etc/nicematrix/backend.env` 的 `LOGTO_VERSION` 已改 `1.43.0` 并重启 backend
（staging / prod-1 `v1.2.661`、prod-3 `v1.2.657`，`/v1/meta` 均正常）。

### 生产回归实测（prod-1，全部用一次性账号、跑完即删）

| 项 | 结果 |
|---|---|
| 版本 / 健康 | `1.43.0`，容器 healthy，`server_error`=0、5xx=0、未捕获异常=0 |
| 13 个 DB alteration | 全部成功；**无任何 invalid index**；7 个新索引全部 `indisvalid` |
| token-exchange 11 项 | **连跑 3 次，每次 11/11** |
| \- id_token 契约 | 无 `at_hash`、头部无 `typ`（v9 契约） |
| \- **双 resource 刷新** | 同一条 RT 分别刷 `https://api.nicematrix.com` 与 `https://apiv3.ej-mobile.cn`，`aud` 均正确 —— 真实跨区组合，2026-08-06 事故场景在 v9 下继续修复 |
| \- subject_token 一次性 | 200 → 400 |
| \- 后端 Account 代理路径 | opaque token + id_token 正常 |
| **§5 MFA 中性化** | `logto_config` 绑定前 `{}` / 绑定后 `{}`，`mfa_verifications` 确实写入 —— **升级对两步验证口径完全中性** |
| `by-identity` | 未命中 404 / 非法 target 400 |
| `verification-records/assert` | 伪造 recordId 422 / 缺 body 400 |

> 说明：生产脚本首轮出现过 2 次「8 passed / 3 failed」，逐条查证为 **curl 偶发空响应**
> （脚本无重试），不是产品问题：同样断言随后连跑 3 次全绿，且 `/api/status`
> 直连容器与走公网各 20 次均 20/20。

### 回滚锚点（都已就位）

| 用途 | 位置 |
|---|---|
| prod-1 镜像回滚 | `nicematrix-logto:rollback-prod-1-20260914-175212`（= `pre-1.43-backup`，1.41.0） |
| staging 镜像回滚 | `nicematrix-logto:rollback-staging-20260914-165311` |
| prod-1 DB | `/root/backups/logto-1.43/prod1-logto-pgdumpall-20260914-161441.sql.gz` + `prod1-logto-PRE-ALTERATION-20260914-175037.sql.gz` |
| staging DB | `/root/backups/logto-1.43/staging-logto-pgdumpall-20260914-161441.sql.gz` |
| prod-1 backend.env | `/root/backups/logto-1.43/backend.env.bak-*` |

⚠️ **镜像回滚时不要跑 `alteration rollback`**：13 个脚本全为增量，1.41 代码不读新表新列，
「回镜像 + 保留 schema」是安全姿势。确需 DB 回退才用上面的 `pg_dumpall`。

---

## 2. 相对方案的偏差（3 处，均为更优解）

### 2.1 token-exchange 不是「贴回 delta」，而是在 v9 骨架上重写

方案预判正确：v9 把 `issueIdToken` / `buildTokenResponse` 做成了可复用 helper。
实际结果是 **override 比升级前更短、更贴近上游**：

- 手写 id_token 块（深引用 `filter_claims.js` + 手工 `at_hash` + 手工
  `conformIdTokenClaims` 分支，约 35 行）→ 换成一行 `issueIdToken(...)`，
  并因此**移除了我们最后一处 `oidc-provider/lib/**` 深引用**（上游新规矩是只有
  seam 模块 `oidc/oidc-provider-internals.ts` 可以深引用）。
- 响应改用 `buildTokenResponse()`，所以不带 `openid`/`offline_access` 的请求
  输出与上游逐字节一致（已实测）。
- refresh_token 那段**故意保留显式 gate**（`offline_access && grantTypeAllowed`），
  没有改用 provider 的 `issueRefreshToken` 钩子 —— 钩子多一条
  `applicationType==='web' && alwaysIssueRefreshToken` 分支。虽然实测 prod-1
  该分支不可达（web 应用该项全 false，且只有 Native 走 token-exchange），
  但保留显式 gate 才能**证明**签发规则未被升级改变。

### 2.2 退役 `custom-profile-fields` override（原 `profilefields-fix-20260715`）

上游 1.43 用新的 `normalizeProfileFields()` 从根上修了同一个问题（对不存在的 catalog
字段**丢弃**而不是抛错），并把 `validateProfileFieldsList()` 收窄给「确实要点名 catalog
字段」的 API（SIE 排序）—— 我们的 `name`/`avatar` 豁免留在那里反而会削弱一个上游刚
收紧的校验。已确认对我们无影响：prod-1 `default` 租户 `account_centers.profile_fields`
为 `NULL`，且 NiceMatrix 的 Account Center 渲染的是自己的 `ProfileSection`，从不读
`profileFields`。

> ⚠️ **`skills/nicematrix-id-logto-deploy` 第 4 步（prod-only lineage guard）点名了
> `profilefields-fix-20260715`。该血缘从 1.43.0 起是"故意不存在"的**，下次部署核对时
> 不要当成回归。（本次部署前已逐项比对新旧镜像：`requestedResources` /
> `hookMatchesRegion` / `by-identity` / `verification-records` / `deletion-request` /
> `mfaIssuerName` / 365d grant / connector `identitySource` / alipay `union_id` /
> 55 个 connector **全部存在且一致**，只有这一项按计划消失。）

### 2.3 社交回调族按「重新推导」处理，不是机械重贴

上游 `b64d46d495` 把登录页与账户中心的社交回调 URI 统一到 `/callback/:connectorId`，
按 OAuth `state` 前缀分流。方案预判的两点都成立：

- **QQ ICP 那一条仍然需要**，但三处调用点现在共用同一个 `getSocialCallbackUri()`，
  这既是简化也是修复（此前两个流程会给 QQ 报两个不同的 redirect_uri，而 QQ 只允许登记一个）。
- **`extractConnectorIdFromPath()` 兜底已删**：上游把 `SocialCallback` 渲染在
  `<Routes path=".../:connectorId">` 里，`useParams()` 永远能解析，兜底是死代码。

ICP 跳板已实测逐字保留 path+query，无需改任何配置。

---

## 3. 本次一并修掉的既有问题

**staging Logto 的 PostSignIn hook 曾指向生产后端，且与生产共用 webhook signing key。**

发现时已定量确认**当时无实际影响**（staging 与 prod-1 只有 6 个 application id 重合，
且这 6 个在生产 `applications.logto_app_id` 里一个都不存在 → 只会 `200 ignored`），
但它依赖「id 永不碰撞」，而 1.43 的 5xx 重试会把一次误投放大到 4 次。

已按 Xianglin 决定一并修复并验证：

| 项 | 修改前 | 修改后 |
|---|---|---|
| staging hook URL | `https://api.nicematrix.com/v1/webhook/logto` | `https://api-staging.nicematrix.com/v1/webhook/logto` |
| staging hook signing key (md5) | `7411e368`（= 生产 key） | `db5a0739`（staging 独有） |
| staging backend `LOGTO_WEBHOOK_SIGNING_KEY` | `7411e368` | `db5a0739`（已重启生效） |

验证：用**新** key 签名投 `api-staging` → `200`；用**生产** key 签名投 `api-staging` → `401`。
prod-1 的 5 个 hook 的 URL 与 signing key **完全未动**（已逐行比对）。
新 key 备份于 `/root/keys/staging-logto-webhook-signing.key`（mode 600）。

---

## 4. 遗留项 / 后续建议（均不阻塞，需单独决定）

| # | 项 | 说明 |
|---|---|---|
| 1 | PostSignIn 的 `login` 遥测写入时机 | `admin-core/webhook.js` 里 `emitActivityEvent({eventType:'login'})` 是裸 INSERT，且发生在 `applyDeviceLoginControl()` **之前**。若后者抛错导致 500，1.43 的重试会多写一行 `login` 事件。**当前无实际影响**（所有消费方都做去重/聚合，没有任何"登录次数"原始计数），但把这行挪到 `applyDeviceLoginControl()` 返回之后即可彻底关掉这个窗口 —— 与同文件里 `device_evicted` 已遵守的「事务提交后再 emit」规则一致。改动量 1 条语句。 |
| 2 | 我方自定义 Account 路由是否补 `assertFirstPartyClient` | 1.43 给所有上游 Account API 写操作加了 first-party 断言；我们自己的 `avatar.ts` / `deletion-request.ts` 没有。**今天是纯 no-op**（prod-1 全部 22 个 application `is_third_party=false`），但补上可与上游安全姿态一致、并在未来真有第三方应用时自动拦住。本阶段按「升级不改语义」原则未做。 |
| 3 | Trusted devices（1.43 新功能） | 租户级开关默认关，本次**未启用**。Account Center 新增了 `trustedDevice` 控制位，`UserScope.TrustedDevices` 已随上游 App.tsx 进入请求 scope（开关关着时完全惰性）。 |
| 4 | CIMD / 动态应用（1.43 新功能） | 默认关，**保持关闭**。注意：一旦设置 `SSRF_ALLOWED_ADDRESSES` 会连带禁用 CIMD —— 不要为了让 webhook 指向私网而设它。 |
| 5 | 标识符锁定计数口径变化 | 1.43 改按规范化标识符归集，部署后既有 Sentinel 锁定可能提前解除（最多提前一个 `lockoutDuration`）。无需动作。 |
| 6 | 人工验收项 | Account Center 六区块 UI 视觉、真实 QQ/微信/支付宝/Microsoft(oid) 绑定回跳、Console 连接器详情页切换、Console「注册与登录」保存（退役 override 后由上游 `normalizeProfileFields()` 兜底的路径）。 |

---

## 5. 客户端契约变更（已写进对外文档站，随 admin-web v1.0.473 发布）

1. **ID token 不再带 `at_hash`，JWT 头不再带 `typ:"JWT"`** —— 官方 SDK 无需动作；
   自实现 ID token 校验的客户端必须放宽这两项。
2. **撤销 opaque access token 会连带撤销同 grant 下的 refresh token** —— 登出只需撤销
   一张 token（推荐 refresh token）；`invalid_target` **永远不得**触发 `RevokeToken`
   （在 1.43 下误撤销的代价从"掉一张 AT"变成"整条会话死亡"）。
3. **撤销端点对 JWT access token 改返 `unsupported_token_type`**（原先假成功 200）。

对应文档：`logto-sdk.md` §0、`identity-auth.md`（§4 + 登出流程）、
`logto-account-api.md`、`callback-urls.md` 1.8.0、`logto-environment-isolation.md`。

> `logto-account-api.md` 同时**更正了一处长期错误描述**：把「已绑定的验证因素」
> 与「两步验证是否开启」讲清楚为两个独立概念，并写明在我们的部署里
> **绑定因子绝不会替用户打开两步验证**（即 §5 override 的对外口径）。

---

## 6. 下一步

阶段二「两步验证改显式开启」(`docs/mfa-explicit-optin-plan.md`) 可以开始了 ——
阶段一已经把 MFA 行为钉死在升级前的口径上，届时任何变化都能干净归因。
本阶段新增的 `routes/account/mfa-verifications.ts` override 预计在阶段二由
`user-mfa-state` 统一判定接管（退役或重写）。
