# 两步验证改为「显式开启」 — 阶段二实施记录

**日期**: 2026-09-14
**基线**: Logto v1.43.0（阶段一升级已上线两区）
**方案**: `docs/mfa-explicit-optin-plan.md`（决策 B1 / D2，Xianglin 2026-09-14 定稿）
**调研前身**: `docs/mfa-state-accuracy-20260909.md`（已由本次实施接替）

---

## 1. 要解决的问题

上游 1.43 对「两步验证是否开启」有三处各自为政的判断（登录强制 / Account API / 账户中心开关），
并且三处都把用户的 `primaryEmail` / `primaryPhone` 当作**隐式**第二因子。prod-1 实测后果：

| 现象 | 规模 |
|---|---|
| 开关显示「开」，实际从未开启 | 143,375 人 |
| 走托管页登录会被真实索要短信 / 邮件验证码（用户从未同意） | 其中约 115,000 人 |
| `enabled` 未设的用户只要登录一次，Logto 就静默写入 `mfa.enabled=true`，永久开启 | 同上，上膛未击发 |
| 已绑因子但 `enabled=false`，开关却显示「开」 | 20 人 |

产品口径：**两步验证只有用户主动打开才算开启**，系统在任何情况下都不得替用户打开。

## 2. 改动

### 2.1 单一事实源（新增，我方文件）

`packages/core/src/libraries/user-mfa-state.ts`

```
isEnabled = mfa.enabled === true
          ∧ mfa.skipMfaOnSignIn !== true
          ∧ usableFactors ≠ ∅
usableFactors = 用户已绑定 ∧ 当前 SIE 仍启用 的因子（备份码用尽不计）；隐式邮箱 / 手机不计
```

登录强制、`/mfa-settings`、账户中心开关**全部消费这一个函数**，三者结构上不可能再漂移。
该文件无上游对应物，升级零维护成本。

与上游的两处差异，均为刻意：

1. 上游把 `enabled` 未设当作「开」；我们当作「关」。
2. 上游把隐式邮箱 / 手机计入「有因子」；我们只认已绑因子（决策 D2）。

第三个合取项不是额外限制：`enabled=true` 但因子被删光时上游同样无法强制，带上它才能保证
「显示 = 行为」。

### 2.2 判定侧

- `core/routes/experience/classes/libraries/mfa-validator.ts`（override）
  `isMfaRequired` 改为消费上述函数。**自适应 MFA 分支与不可跳过策略（Mandatory 系）分支保持
  上游逻辑不变** —— 租户强制 MFA 时，个人开关不得削弱它；两区自适应 MFA 均为 `enabled:false`。
- `userEnabledMfaVerifications` / 挑战页可用因子列表**未动**：一旦进入挑战，邮箱 / 手机仍是
  备用通道（Package A 三层死锁防御完整保留）；而挑战现在只可能发生在确有已绑因子的用户身上。

### 2.3 写入侧（谁可以写 `mfa.enabled`）

| 入口 | 上游 1.43 | 本次 |
|---|---|---|
| 账户中心「添加验证方式」 | 自动写 `true` | **不写**（阶段一已摘，本次沿用） |
| 账户中心两步验证开关 | 只写 `skipMfaOnSignIn` | **唯一权威入口**：`isEnabled` 一次写两个标志 |
| 登录引导页完成绑定 | 写 `true` | **保持写 `true`**（决策 B1，页面标题即「设置两步验证」） |
| 登录时 `enabled` 未设的静默回填 | 写 `true` | **已移除**（`experience/classes/mfa.ts`） |
| 删除最后一个可用因子 | 不回写 | **补写 `false`**（`account/mfa-verifications.ts`） |
| 注册 provision | 写 `false` | 不变 |

附带一处（方案外、为闭合 B1 而必需）：用户在账户中心把开关**关掉**后，登录时不再弹「设置两步
验证」引导页。否则刚关掉就被追问，且在那页完成绑定只会写 `enabled=true` 而 `skipMfaOnSignIn`
仍为 `true`，功能依旧是关的——自相矛盾。改后严格比今天更少打扰，且对强制策略不可达。

### 2.4 展示侧（不新增端点）

`GET / PATCH /api/my-account/mfa-settings` 新增三个字段：

| 字段 | 含义 |
|---|---|
| `isEnabled` | 两步验证是否真的生效 → **客户端从此只读这个** |
| `hasUsableFactor` | 是否具备已绑因子（决定开关能否打开） |
| `usableFactors` | 具体因子列表 |

`PATCH` 新增可选入参 `isEnabled`：开 = `enabled=true` + `skipMfaOnSignIn=false`，
关 = `enabled=false` + `skipMfaOnSignIn=true`。无已绑因子时请求开启返回 400
（`user.missing_mfa`，复用既有错误码，不新增 i18n key）。

纯增量：两个入参都可选，只发 `skipMfaOnSignIn` 的旧客户端行为与上游完全一致。

### 2.5 UI

`account/src/pages/Security/MfaSection/index.tsx`（新增 override）

- 开关由 `skipMfaOnSignIn === false` 改绑 `isEnabled`；写入改发 `isEnabled`。
- `hasUsableFactor = false` 时开关**置灰**，并复用既有
  `account_center.security.no_verification_method_warning` 提示先添加验证方式。
- **不新增 i18n key**，不改动周边结构 / 样式 / 骨架屏。

## 3. 存量数据

**一个用户的 `logto_config` 都没有改**：不回填、不迁移、不发通知（口径 #3）。

| 人群 | 改前真实行为 | 改后真实行为 | 改后开关 |
|---|---|---|---|
| 75 人 `enabled=true` + 有因子 | 强制 | 强制（不变） | 开 ✅ |
| 11 人 `enabled=true` + 已跳过 | 不强制 | 不强制 | 关 ✅ |
| 20 人 `enabled=false` + 有因子 | 不强制 | 不强制 | 关 ✅（今天错显示为「开」） |
| 151 人 `enabled=false` + 无因子 | 不强制 | 不强制 | 关 ✅ |
| 143,375 人 `enabled` 未设 + 无因子 | 其中约 11.5 万会被隐式强制 | **一律不强制** | 关 ✅ |

**没有任何一个用户会失去他主动开启过的两步验证。** 唯一被取消的强制，是系统从未征得同意的那
11.5 万条隐式短信 / 邮件 2FA。`enabled` 未设 + 有已绑因子这一格实测为 0 人，因此不存在
「本来被强制、改后突然不被强制」的情况。

## 3.1 上线记录

| 目标 | 内容 | 结果 |
|---|---|---|
| id-staging | 镜像 `release-e22b89b7…-20260914-145738` | 已上，30/30 验证全绿 |
| **prod-1 (= 两区 Logto)** | 同一镜像（`RootFS.Layers` 双端一致） | 已上，healthy，`server_error=0`，回滚锥 `rollback-prod-1-20260914-212528` |
| m1 / m2 / m.nicematrix.com / m.ej-mobile.cn | admin **v1.0.474** 文档站 | 已上，四站逐页验收通过 |

**血统护栏（新旧镜像逐项对比，prod-1 上实测）**：`requestedResources` 7、`hookMatchesRegion` 2、
`by-identity` 2、`verification-records` 4、`mfaIssuerName` 5、`assertFirstPartyClient` 31、connectors 49
—— **全部不变**；唯一差异是 `getUserMfaState` 0→5、`hasUsableFactor` 0→10。无任何 prod-only 修复被回退。

**上线后存量实测（prod-1）**：总用户 143,636，带 `mfa.enabled` 键的仍为 **257** 人（与上线前相同）。
分布也与 §1 调研表一致；【`enabled` 未设 + 有已绑因子】这一格仍为 **0 人**。
该计数不再增长，就是静默回填已被拆除的持续证据 —— **建议盯一周**。

## 4. 自检

- `pnpm --filter @logto/core build`（tsc）：0 error。
- `pnpm --filter @logto/account check`：本次涉及文件 0 error（其余报错为既有 override 的
  phrase 类型问题，与本次无关）。
- `jest src/pages/Security`：**38 passed / 38**，含新增用例「无已绑因子时开关置灰且不可写入」。
- staging 端到端验证：`docs/upgrade-1.43/smoke/smoke-mfa-explicit-optin.sh` —— **30 passed / 0 failed**
  （§9 十一项全覆盖，每条「开关说 X」都配一次真实托管页登录验证行为）。
- 回归：`smoke-mfa-neutral` 10/10、`smoke-first-party-account-writes` 17/17、`smoke-hosted-login` 13/13。
  后者的 MFA 断言已改写：管理员通过 Management API 预置的因子**不再构成强制** —— 这是本次
  口径的直接后果，若有运营流程依赖「后台装上 TOTP = 强制用户二次验证」需改流程（现网无此用法）。

## 5. 文档

对外文档站（两区都发）：`docs/integration/logto-sdk.md` §MFA、`logto-account-api.md` §5、
`identity-auth.md` —— 原文正在**主动教错**（指引客户端用因子列表判断开关状态），已改写并附
客户端迁移对照表。本仓内部：`logto-custom/README.md` 登记全部 override，
`docs/mfa-state-accuracy-20260909.md` 标注已被接替。
