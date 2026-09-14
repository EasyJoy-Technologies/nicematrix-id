# 阶段一 §10 开工前置动作项 —— 核查结果

**执行:** 2026-09-14 —— 对应 `PLAN.md` §10。全部为只读核查，未改动任何生产配置。

---

## 1. 后端 3 个 webhook 接收端幂等性（1.43 起 5xx 最多重试 3 次）

先确认上游重试契约本身（`core/src/libraries/hook/utils.ts`，v1.43.0）：

- 只对 **HTTP 5xx** 重试，`limit = hookConfig.retries ?? 3`（即每个 hook 可单独设 `retries: 0` 关闭）。
- **网络错误不重试**（`abortRetryOnNonHttpError` 显式 rethrow），4xx 不重试，408/429 被有意排除。
- 503 的 `Retry-After` 头会被丢弃，避免接收端控制重试节奏。

逐个接收端核查：

| 接收端 | 结论 | 依据 |
|---|---|---|
| `POST /v1/webhook/logto/user-deleted`<br>(`modules/user-deletion/webhook.js`) | ✅ **幂等，且本来就依赖重试** | 级联清理 `cascadeCleanupBackendDb()` 设计为可重入；代码里已有 F7 注释：部分失败时**主动返回 500 让 Logto 重投**。1.41 其实并不重试，所以 1.43 是**修复**了这条路径长期缺失的重投能力 |
| `POST /v1/sms/logto/verify-feedback`<br>(`modules/sms/verify-feedback.js`) | ✅ **幂等** | 签名校验后**先 200 应答**再 `setImmediate` 异步做 Twilio approve；唯一的 5xx 是「未配置签名密钥」的 503 fail-closed，发生在任何副作用之前。Twilio approve 本身重复调用无害且已 try/catch |
| `POST /v1/webhook/logto`（PostSignIn 设备登录控制）<br>(`modules/admin-core/webhook.js`) | ✅ **关键副作用幂等**；一处遥测非幂等（影响可忽略） | `applyDeviceLoginControl()` = upsert + 重新统计 + 驱逐，重跑结果一致（已被驱逐的设备 `is_logged_in=false`，第二次不会再进候选集，也不会重复发 `device_evicted`）；`preRegisterDerivedToken()` 是 upsert。**唯一非幂等**：`emitActivityEvent({eventType:'login'})` 是裸 INSERT，若 `applyDeviceLoginControl` 抛错导致 500，重投会多写一行 `login` 事件 |

**对那一行遥测重复的影响评估**：`user_activity_events` 的所有消费方都做去重/聚合——
DAU 走 `COALESCE(user_id, device_ref)` 去重（`admin-core/analytics.js`），终端用户列表走
`MIN/MAX(created_at)`，设备详情取最近 N 条。**没有任何"登录次数"原始计数**。因此重复行不改变
任何对外指标，只会在设备事件流里多一行。

**结论**：3 个接收端满足 1.43 的幂等要求，**升级不被阻塞，无需后端改动**。

**建议的后续优化（非阻塞，不属于本阶段）**：把 PostSignIn 里的 `login` 遥测写入挪到
`applyDeviceLoginControl()` 返回之后——与同文件里 `device_evicted` 已经遵守的「事务提交后再 emit」
规则一致，可把这个唯一的重复窗口也关掉。记入 `POST-UPGRADE-REVIEW.md`。

---

## 2. 客户端 agent 知会（不阻塞升级）

三条客户端契约变更，已逐条回到 v9 fork 源码核实（`logto-io/node-oidc-provider@513c523c`）：

1. **ID token 不再带 `at_hash`，JWT 头也不再带 `typ:"JWT"`**
   —— `lib/helpers/grant_common.js issueIdToken()` 不再 `token.set('at_hash', …)`；
   `lib/models/id_token.js` 的 `idtoken` 分支 `signOptions` 不含 `typ`。
   官方 Logto SDK 不受影响；**自己实现 ID token 校验的客户端必须放宽这两项**。
2. **撤销 opaque access token 会连带撤销同 grant 下的 refresh token**
   —— `lib/actions/revocation.js`：`if (token.kind === 'RefreshToken' || token.kind === 'AccessToken') await revoke(ctx, token.grantId)`，
   `lib/helpers/revoke.js` 对该 grantId 下的 AccessToken / RefreshToken / AuthorizationCode 等
   全部 `revokeByGrantId()`。（默认 `revokeGrantPolicy` 在撤销 AT 时**不**删 Grant 记录本身，
   但 refresh token 确实被销毁。Logto 未覆盖该默认值。）
3. **撤销端点对 JWT access token 改返 `unsupported_token_type`（原先假成功 200）**
   —— `lib/shared/reject_structured_tokens.js`。服务端无需改动。

> 与既有硬规则的叠加提醒：`invalid_target` **永远不能**触发 `RevokeToken`。
> 在 1.43 下这个误判的破坏力更大——一次误撤销会直接带走整条会话的 refresh token。

---

## 3. DBA：索引锁风险与停机窗口

13 个 alteration **全部是增量**（新表 / 新列 / 新索引），无破坏性迁移。

**关键结论：所有落在大表上的新索引都用了 `CREATE INDEX CONCURRENTLY`**（在
`beforeUp` 里执行，`up` 故意留空，因为 concurrently 不能在事务里跑）：

- `1.42.0-…-add-service-logs-created-at-index`
- `1.43.0-…-add-oidc-model-instances-account-id-partial-index`（并附带 `analyze`）
- `1.43.0-…-add-tenant-aware-scope-indexes`
- `1.43.0-…-add-oidc-session-extensions-account-id-index`
- `1.43.0-…-add-service-logs-email-indexes`

prod-1 实测表体量（`id.nicematrix.com` Logto 库）：

| 表 | 总大小 | 估算行数 |
|---|---:|---:|
| `logs` | 186 MB | 143,341 |
| `users` | 113 MB | 140,746 |
| `oidc_model_instances` | 57 MB | 43,196 |
| `daily_active_users` | 22 MB | 77,151 |
| `oidc_session_extensions` | 832 kB | 443 |
| `service_logs` | 不在前 12 大表内（极小） | — |

**结论：不需要停机窗口，不需要低峰期安排。** 受影响的最大表只有 57 MB / 4.3 万行，
且建索引全程不阻塞写入。`logs`（186 MB）本次没有新索引。

---

## 4. 其余 §3 破坏性变更的 prod-1 实测复核

| 项 | 复核结果 |
|---|---|
| token exchange 的 subject token 必须来自 first-party 应用 | ✅ prod-1 全部 **22 个** application `is_third_party = false`（逐行查过） |
| Account API 写操作对外部应用一律 403（`assertFirstPartyClient`） | ✅ 同上，全 first-party，无影响 |
| SSRF 防护默认开启 | ✅ 5 个 hook 的目标均为公网地址；**不要**设 `SSRF_ALLOWED_ADDRESSES`（会连带禁用 CIMD） |
| Custom JWT / Actions 改 worker 池（5s / 128MB） | ✅ `logto_configs` 无任何 JWT customizer 配置行 |
| `issueRefreshToken` 的 `web + alwaysIssueRefreshToken` 分支 | ✅ prod-1 所有 `Traditional`(web) 应用该项均为 `false`，且只有 `Native` 应用走 token-exchange——该分支不可达。（本次 override 仍保留显式 gate，不依赖这个事实） |

prod-1 当前 5 个 hook（本次升级不改动其配置）：

| hook | 事件 | 目标 | region tag |
|---|---|---|---|
| `04xfszlsjhhmccqzo6w6n` | `User.Deleted` | `api.nicematrix.com/v1/webhook/logto/user-deleted` | — |
| `9aiz0tmuqb834vpu1nkcx` | `PostSignIn` | `api.nicematrix.com/v1/webhook/logto` | `intl` |
| `3wswwkcjxlh4snzrwcc3t` | `PostSignIn` | `apiv3.ej-mobile.cn/v1/webhook/logto` | `cn` |
| `n27nsh066104aqemffj1p` | `User.Deleted` | `apiv3.ej-mobile.cn/v1/webhook/logto/user-deleted` | — |
| `yl79v1h3wflayymfw86ey` | `PostRegister`/`PostSignIn`/`PostResetPassword` | `api.nicematrix.com/v1/sms/logto/verify-feedback` | `intl` |
