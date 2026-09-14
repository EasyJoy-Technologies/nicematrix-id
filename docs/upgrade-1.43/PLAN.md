# 阶段一 — Logto 1.41.0 → 1.43.0 升级方案

**Owner:** nicematrix-system agent
**Drafted:** 2026-09-14 —— **仅方案，未做任何代码 / 配置 / 数据改动**
**阶段二（两步验证口径改造）:** `docs/mfa-explicit-optin-plan.md` —— 本阶段完成并稳定后再执行
**关联:** `docs/upgrade-1.41/PLAN.md`（同一方法论）、`logto-custom/README.md`（override 登记册）、
`skills/nicematrix-id-logto-deploy`（构建/部署硬流程）
**Drift 明细:** `docs/upgrade-1.43/OVERRIDE_DRIFT_AUTO.txt`

---

## 0. 本阶段的边界

- **只做版本升级，不改变任何业务语义。**
- 升级引入的**唯一一处会自行改变 MFA 语义的上游变更**（1.42 `d91696c70`，
  "Account API 绑定因子后自动开启 MFA"）在本阶段就地**中性化**，见 §5。
  理由：升级不应该偷偷改掉两步验证的开启规则；真正的口径改造归阶段二。
- 两步验证的展示 / 开关 / 判定改造 **全部不在本阶段**。

---

## 1. Drift — 实测，非估算

对 `logto-custom/overrides/` 下**全部 88 个文件**逐个比对 `v1.41.0 → v1.43.0`：

| 桶 | 数量 | 含义 | 动作 |
|---|---:|---|---|
| 我方新增文件 | 28 | 上游从来没有（自定义 API、ProfileSection 编辑器、native-caps、region-routing、mfa-issuer 常量、svg…） | 纯透传，零工作量 |
| 上游未变 | 38 | 1.41→1.43 字节相同 | 原样复用，只需验证路径仍存在 |
| 上游已变 | **21** | 上游改了我们 override 的同一文件 | **需三方合并** |
| 上游删除 | **0** | 没有任何 override 失去上游母体 | 无 |

上游 1.41→1.43 共 287 个 commit；新增 **13 个** DB alteration（详 §4）。

## 2. 21 个待合并文件 — 按风险分级

### 2.1 A 级：认证热路径（HIGH，需独立 spike）

| 文件 | 上游 Δ | 我方 delta | 说明 |
|---|---:|---:|---|
| `core/src/oidc/grants/token-exchange/index.ts` | +67/-33 | **244 行** | **本次唯一的结构性重写。** 1.42 把 node-oidc-provider 升到 **v9**、Koa 升到 **3**。上游新增 `oidc/oidc-provider-internals.ts` 接缝模块，把 `resolveResource / validatePresence / createAccessToken / validateAccount / issueIdToken / buildTokenResponse / applyDpopBinding …` 全部改为从接缝导入；handler 签名由 `(ctx, next)` 变为 `(ctx)`（不再 `await next()`）；DPoP/mTLS 由 `handleDPoP`/`handleClientCertificate` 两函数拆成四个；`Account.findAccount` 换成 `validateAccount(ctx, findAccount, …)`；`checkOrganizationAccess` 改对象入参并多收 `envSet`。<br>我们的三块 delta（`id_token` 签发、`refresh_token` 签发、多 resource 注册）**不能贴回去，必须在新骨架上重新实现**。<br>**利好**：v9 接缝把 `issueIdToken` / `buildTokenResponse` 做成了公开可复用 helper，重写后的 override 预计**比现在更短、更贴近上游**（不再手工拼 `at_hash`、不再手抄 refresh-token grant 的 id_token 分支）。<br>**必须重新验证**：① `Object.create(ctx)` 派生-ctx 规避多 resource 数组的手法在 v9 `resolve_resource` 下是否仍成立（上游自身已改成传 `{resourceIndicators: new Set([params.resource])}` 假 model）；② `provider.RefreshToken` 构造与 `grantId` 绑定在 v9 下的行为；③ `logto-custom/tests/test-token-exchange-multi-resource.js` 全 16 例必须过。 |
| `core/src/oidc/init.ts` | +136/-22 | **10 行（实为 1 行语义）** | 我方 delta 仅 `Grant` 绝对上限 180→**365 天**一行。上游改动大（v9 适配、CIMD、SSRF、client-scope），**必须整文件重取 1.43 版再贴回这一行**，不可手工合并。 |

### 2.2 B 级：Webhook / 社交回调（MED，语义合并）

| 文件 | 上游 Δ | 我方 delta | 说明 |
|---|---:|---:|---|
| `core/src/libraries/hook/index.ts` | +62/-7 | 19 | 我方 PostSignIn region 扇出过滤。上游新增 `Grant.LimitExceeded` 事件、5xx 重试、SSRF 校验。需把过滤块重贴进新的扇出逻辑。 |
| `schemas/src/types/hook.ts` | +38/-3 | 12 | 我方 `region?` 字段；上游纯增量，冲突低。 |
| `core/src/libraries/hook/context-manager.ts` | +5/0 | 6 | 低风险。 |
| `core/.../koa-experience-interaction-hooks.ts` | +2/-1 | 4 | 提取 `params.region`，低风险。 |
| `core/.../koa-interaction-hooks.ts` | +2/-1 | 4 | 同上。 |
| `account/src/pages/SocialCallback/index.tsx` | +2/-9 | 44 | ⚠️ 上游 `b64d46d495` **统一了 SIE 与 Account Center 的 social callback URI** —— 正好压在我方 QQ ICP `callbackOrigin` override + connectorId-from-path 兜底上。**不可机械重贴，必须重新推导**我方需求在新统一模型下是否仍成立（很可能上游的统一已覆盖 connectorId-from-path 兜底，我方只需保留 QQ ICP 一条）。 |
| `account/src/pages/SocialFlow/index.tsx` | +10/-10 | 5 | 同上族，QQ ICP origin 一行。 |
| `experience/.../use-social-sign-in-listener.ts` | +15/-5 | 20 | 同上族，需一并推导。 |

### 2.3 C 级：其余（LOW-MED，机械重贴）

`core/libraries/custom-profile-fields/index.ts`（+51/-26，我方 48 行）、
`core/routes/sign-in-experience/index.ts`（+6/-2，我方 19 行 OSS 去 branding）、
`core/routes/account/index.ts`（+18/-8，我方 2 行挂载 avatar/deletion 路由）、
`core/routes/admin-user/index.ts`（+2/0，我方 2 条路由挂载顺序）、
`experience/shared/utils/search-parameters.ts`（+34/-8，我方 native-caps 捕获 1 处）、
`experience/utils/sign-in-experience.ts`（+15/-2）、`account/src/App.tsx`（+3/-1）、
`console/consts/{tenants,third-party-links}.ts`、`console/pages/ConnectorDetails/index.tsx`（我方 1 行）、
`toolkit/core-kit/src/regex.ts`（用户名允许点号，3 行）。

## 3. 上游 breaking change — 逐条对 prod-1 实测核查

| 上游变更 | 我们的暴露面 | 实测结论 |
|---|---|---|
| **node-oidc-provider v8→v9**（1.42） | token-exchange override 直接吃内部 API | ⚠️ **本次最高风险**，见 §2.1 |
| **Koa 2→3**（1.42） | 我方自定义路由（by-identity / verification-records / avatar / deletion-request） | 上游声明"无行为变化"；我方路由均为 koa-router + koa-guard 标准姿势，风险低，需 smoke |
| 撤销 opaque access token **连带撤销同 grant 下的 refresh token** | 客户端登出调 RevokeToken | ⚠️ **行为变化**。方向更正确（与 MEMORY 中"Logout gap"待办同向），需提前知会各客户端 agent |
| 撤销端点对 JWT access token 返回 `unsupported_token_type`（原先假成功） | 若有客户端撤销 JWT AT | 需客户端 agent 确认；服务端无需改 |
| ID token 在 token 端点**不再带 `at_hash`**、不再带 `typ:"JWT"` 头 | 我方 token-exchange override 目前**手工设了 `at_hash`**；客户端若自实现 ID token 校验 | 重写时改走上游 `issueIdToken`，与上游一致；**需知会客户端 agent**（官方 SDK 无需动作；自实现校验的需放宽这两项） |
| **token exchange 的 subject token 必须来自 first-party 应用**（1.43，标注 Breaking） | 原生社交登录主链路 | ✅ **无影响** —— prod-1 全部 22 个 application `is_third_party = f`（已逐行核）；且我方走 Management API 铸造的 subject-token，不是 access_token 路径 |
| token exchange 的 JWT subject token 必须带 `at+jwt` 头 + `client_id` | 同上 | ✅ 无影响 —— 我方走 opaque subject-token 路径 |
| **Account API 写操作对外部应用一律 403** + 新增 `assertFirstPartyClient` | 各 App 直接调 Account API | ✅ 无影响 —— 全部 first-party |
| **SSRF 防护默认开启**，覆盖 webhook 投递与 SSO 出站 | 5 个 hook | ✅ **无影响 —— 已在 Logto 容器内做 DNS 实测**：`api.nicematrix.com` → `188.114.96.9`（Cloudflare 公网）、`apiv3.ej-mobile.cn` → `47.100.182.243`（公网），均非 special-use 地址。**不要**设 `SSRF_ALLOWED_ADDRESSES`（一旦设置会连带禁用 CIMD） |
| Custom JWT / Actions 脚本改 worker 池运行，5s / 128MB 上限 | — | ✅ 无影响 —— `logto_configs` 中**无任何 JWT customizer 配置行** |
| **Webhook 遇 5xx 重试最多 3 次**（1.43） | backend `/v1/webhook/logto`、`/v1/webhook/logto/user-deleted`、`/v1/sms/logto/verify-feedback` | ⚠️ **升级前必须验证这 3 个接收端幂等**（上游明确要求 receiver 幂等）。本次唯一需**后端配合**的动作项 |
| **Account API 绑定因子后自动写 `mfa.enabled=true`**（1.42 `d91696c70`） | 两步验证语义 | ⚠️ **与既定产品口径冲突**（用户不主动打开就不能算开）→ 本阶段**就地中性化**，见 §5 |
| 标识符锁定计数改按规范化标识符归集 | Sentinel 锁定 | 运维提示：部署后既有锁定可能提前解除（最多提前一个 `lockoutDuration`）。无需动作 |
| CIMD / 动态应用（1.43 新功能） | — | 租户级开关，默认关，**保持关闭** |
| Trusted devices（1.43 新表 + Account Center 新区块） | — | 默认关，**本次不启用**；注意 account-center 新增 `trustedDevice` 控制位 |
| 自定义域名验证文件、SAML AuthnRequest 签名、Gmail 别名归一、Accept-Language q 值 | — | 未使用 / 纯增强，无动作 |

## 4. DB alteration

13 个新脚本，**全部增量**（新表 / 新索引 / 新列），**无破坏性迁移**：

- `1.42.0` ×3：domain-verification-files、service-logs `created_at` 索引、saml-sso 签名密钥表
- `1.43.0` ×10：`oidc_model_instances` account_id 偏索引、tenant-aware scope 索引、
  CIMD 四张表（permission-ceiling / client-identifier 列 / grant-organizations / grant-client-snapshots）、
  `oidc_session_extensions` account_id 索引、**`trusted_devices` 新表**、service-logs email 索引、
  CIMD pkey 收紧（新表上）

走标准 `database alteration deploy next`。

⚠️ **建索引锁风险**：`oidc_model_instances`、`service_logs` 在 prod-1 上体量不小。
执行前先量表大小 + 确认脚本是否 `CONCURRENTLY`；若非并发建索引，需安排低峰窗口并计入停机时间。

## 5. 唯一的语义中性化 override（本阶段必做）

**背景**：1.42 `d91696c70` 让 Account API 绑定 TOTP / 备份码 / WebAuthn 时
同步写 `logtoConfig.mfa.enabled = true`（`packages/core/src/routes/account/mfa-verifications.ts`
共 4 处调用点）。这等于"**用户加了一个验证方式，系统就替他把两步验证打开了**"，
与既定产品口径（必须用户主动打开）冲突。

**本阶段动作**：新增 override 摘掉这 4 处 `logtoConfig` 写入，
使"绑定因子"回到 **只写 `mfa_verifications`、不碰 `enabled`** 的 1.41 行为。

- 纯删除性改动，无新增逻辑，风险极低。
- 保证**阶段一是 MFA 行为中性的**：升级前后两步验证的开启规则完全一致，
  prod-1 出问题时可以干净归因到升级本身。
- 该 override 在阶段二会被 `user-mfa-state` 统一判定接管（届时退役或重写）。

### 5.1 可靠性论证：摘掉它会不会引发别的问题？（已逐路径核查）

`mfa.enabled` 在 1.43 全仓共 6 处读取点，逐一核过：

| 读取点 | 摘掉自动写入后的影响 |
|---|---|
| `mfa-validator.isMfaRequired`（登录强制） | 与 1.41 完全一致 —— 1.41 本来就不写，行为无变化 |
| `experience/classes/mfa.ts` `assertOptionalMfaEnablement`（登录引导） | **唯一有可见影响的点**，详见下方 |
| `interaction/verifications/mfa-verification.ts`（legacy interaction） | 只读 `skipMfaOnSignIn` 与 `skipped`，不读 `enabled`，无影响 |
| `account/logto-config.ts`（`GET /logto-configs` 原始 flag） | 只做透传，无判定逻辑，无影响 |
| `admin-user/basics.ts`（Management API 用户详情） | 同上，只做透传，无影响 |
| `libraries/user-logto-config.ts` | 纯读写工具，无判定逻辑，无影响 |

**关于唯一有影响的登录引导路径**：用户 `enabled=false` 且已绑因子时，
`assertOptionalMfaEnablement` 会抛 `user.suggest_mfa`（422），前端弹出
「开启两步验证」引导页。要点：

1. **这不是升级带来的新行为** —— 1.41 今天就是这样（1.41 的 Account API 绑定同样不写 `enabled`）。
   摘掉 1.42 的自动写入 = **精确还原今天的行为**，没有引入任何新东西。
2. 该引导页**带跳过按钮**，用户点一次跳过即写 `mfa.skipped=true`，
   此后**永久不再提示**（`assertOptionalMfaEnablement` 第一道 bypass）。不存在无限骚扰。
3. 在新口径下这个引导页恰恰是**我们想要的**：系统不再擅自替用户打开，
   而是明确地问用户一次。用户在这一页完成绑定 → 按决策 B1 算作主动打开。

**结论：摘掉 1.42 的自动写入是安全的**，它只是让升级对 MFA 保持中性，不产生新的失败模式。

> ⚠️ 另有一条**独立于本次升级**的隐式自动开启路径（`assertMfaEnabledOrSuggest` 里的
> `markMfaEnabled()` 静默回填），1.41 就已存在，影响面达 11.5 万用户。
> 它不属于本阶段（本阶段只做"相对今天中性"），归阶段二处置 ——
> 详见 `docs/mfa-explicit-optin-plan.md` §3.2。

## 6. 构建侧

- `logto-custom/Dockerfile` **无需改动**：`node:22-alpine` + `pnpm@^10` 仍满足 1.43；
  连接器仍由 `pnpm cli connector link` 全量自动挂载（1.42/1.43 新增连接器自动纳入）。
- 构建机剩余磁盘 **32G / 150G（已用 78%）** → 构建前先 `docker builder prune`。
- prod-1 剩余 **44G / 75G**，充裕。

## 7. 执行阶段（每阶段需单独确认）

- **Stage 0 安全垫**：分支 `upgrade/logto-1.43`；staging + prod-1 各打 `pre-1.43-backup` 镜像 tag；
  两边 `pg_dumpall` 全量备份；`docker builder prune`。
- **Stage 1 submodule bump**：`logto-upstream` checkout `v1.43.0` + 提交。
- **Stage 2 override 三方合并**：按 A→B→C 顺序；A 级 token-exchange 单独 spike + 单测先行；
  每个文件合并后与上游 `diff` 复核"仅差我方 marker 块"。§5 的中性化 override 同期加入。
- **Stage 3 构建 + id-staging 验证**：按 `skills/nicematrix-id-logto-deploy` 全流程
  （systemd-run 构建、save/load + md5、RootFS.Layers 同一性证明、回滚锚点）。
- **Stage 4 staging smoke（硬门禁，全绿才进 prod）**：
  1. 托管页登录 / 注册
  2. 原生社交登录 token-exchange（含 `id_token` + `refresh_token` + **双 resource**）
  3. `refresh_token` 对主 / 次 resource 各刷一次
  4. Account Center 六区块（资料 / 邮箱手机 / 密码 / 社交 / MFA / 注销）
  5. QQ / 微信 / 支付宝 / Microsoft(oid) 绑定回跳
  6. 5 个 webhook 实投 + 重试幂等
  7. Management API：`by-identity`、`verification-records/assert`
  8. Console 登录与连接器页
  9. **MFA 行为中性回归**：绑定 TOTP 后 `logto_config.mfa.enabled` 保持不变（§5 验证）
- **Stage 5 prod-1 部署**：**高风险，需单独确认**。重启中断登录约 10–30s。
  prod-3(cn) 跨境共用 prod-1 Logto，一次生效，cn 侧无独立 Logto 动作。
- **Stage 6 收尾**：三台主机 `/etc/nicematrix/backend.env` 的 `LOGTO_VERSION` 改 `1.43.0` + 重启 backend；
  更新 `memory/runbooks/infrastructure.md` 版本行、`logto-custom/README.md`、本目录 `POST-UPGRADE-REVIEW.md`。
- **Stage 7 文档系统同步（硬性收尾，不做不算完工）** → 见 §9。

## 8. 回滚

镜像层面：`docker tag` 回 `pre-1.43-backup` + `force-recreate`（分钟级）。

⚠️ **DB alteration 不随镜像回滚** —— 13 个脚本均为增量、对 1.41 代码无害（1.41 不读新表新列），
因此"镜像回滚 + 保留新表"是安全的回滚姿势；**不要**跑 `alteration rollback`。
确需 DB 回退时才用 Stage 0 的 `pg_dumpall`。

## 9. 发布收尾：文档系统必须同步到最新

> **硬性要求：开发完成后必须更新对外文档站，不得残留旧内容误导客户端开发。**

文档站两个入口（两个 region 各一套，**都要更**）：

| 入口 | 内容来源 | 发布方式 |
|---|---|---|
| `m.ej-mobile.cn/docs/`（cn）<br>`m.nicematrix.com/docs/`（intl） | backend 仓 `docs/**.md` 静态文件，清单由 `apps/admin-web/src/shared/docs/manifest.ts` 驱动 | 随 **admin-web 部署**落到 webroot |
| `m.ej-mobile.cn/docs/api/`<br>`m.nicematrix.com/docs/api/` | `server.js` 的 `@api` 注释块 → `npm run docs:generate` → `docs/integration/openapi-docs.yaml` | 同上（`prebuild` 已强制跑 `docs:generate`） |

### 本阶段（升级）需核改的页面

本阶段不改任何后端路由，所以 **OpenAPI 无需重生**；但以下 **客户端契约变更**必须写进文档：

| 文档页 | 必须更新的内容 |
|---|---|
| `docs/integration/logto-sdk.md` | ① ID token 在 token 端点**不再带 `at_hash`**、不再带 `typ:"JWT"` 头 —— 自实现校验的客户端需放宽；官方 SDK 无需动作。② 撤销 opaque access token 会**连带撤销同 grant 下的 refresh token**。③ 撤销端点对 JWT access token 改返 `unsupported_token_type`（原先假成功） |
| `docs/integration/identity-auth.md` | 同上登出 / token 生命周期描述；核对 Logto 版本号表述 |
| `docs/integration/logto-account-api.md` | 核对全文与 1.43 实际行为；附带修正 §5 那段已知错误的 2FA toggle 描述（完整改造在阶段二） |
| `docs/integration/callback-urls.md` | 核对上游统一 social callback URI 后描述是否仍准确 |
| `docs/runbooks/logto-environment-isolation.md` | Logto 版本号 1.41.0 → **1.43.0** |

### 收尾步骤

1. 改 backend 仓对应 `docs/**.md`；若新增文档页，同步补 `manifest.ts` + `shared/i18n/locales/*.json`
   的 `docs.title.<key>`（**全 locale，禁英文兑底**）+ `docs/README.md` 索引。
2. `cd apps/admin-web && npm run docs:check`（有路由变更时跑 `docs:generate`）—— OpenAPI 陈旧会阻断构建。
3. 按 `skills/admin-web-deploy`（3 个 Vite 入口）部署 intl；按 `skills/prod3-cn-deploy` 部署 cn。
   ❗ 部署前必比对「线上 admin 版本 → 待发版本」全差量（MEMORY 已记录过事故）。
4. **逐条验收线上页面**（不是看构建成功就算完）：
   `m.ej-mobile.cn/docs/` 与 `m.nicematrix.com/docs/` 上述 5 页内容为新版；
   `/docs/api/` 能正常渲染；强刷新确认无 CDN / 浏览器缓存残留。
5. 全文搜一遍旧表述（如 `1.41`、`at_hash` 必须存在、旧登出语义），**确认零残留**。

## 10. 开工前置动作项

1. **后端**：确认 3 个 webhook 接收端幂等（1.43 起 5xx 会重试 3 次）。
2. **客户端 agent 知会**（不阻塞升级，需同步）：
   撤销 opaque AT 将连带撤销 RT；ID token 不再带 `at_hash` / `typ:JWT`；
   撤销端点对 JWT AT 改返 `unsupported_token_type`。
3. **DBA**：量 prod-1 `oidc_model_instances` / `service_logs` 表大小，
   确认新索引是否 `CONCURRENTLY`，据此决定是否需要停机窗口。
