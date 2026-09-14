# 阶段二 — 两步验证「显式开启」口径改造方案

**Owner:** nicematrix-system agent
**Drafted:** 2026-09-14 · 决策 B/D 已确认 —— **仅方案，未做任何代码 / 配置 / 数据改动**
**前置:** `docs/upgrade-1.43/PLAN.md`（阶段一，Logto 1.43 升级）必须先完成并稳定
**调研来源:** `docs/mfa-state-accuracy-20260909.md`（已由本方案接替）
**相关:** `docs/mfa-deadlock-prevention.md`（Package A）、
backend `docs/integration/logto-account-api.md` §5 与 `logto-sdk.md` §MFA（均需同步修订）

---

## 0. 产品口径（Xianglin 2026-09-14 确定，本方案唯一准绳）

1. **两步验证只有用户主动打开才算开启**，系统在任何情况下都不得替用户打开。
2. **添加验证方式（TOTP / 备份码 / passkey）≠ 开启两步验证。**
3. **存量用户一律保持现状**，不做任何"帮他打开"的回填。
4. 开关与 API 返回的状态必须与**登录时是否真的会被要求二次验证**完全一致；做不到就宁可去掉开关。
5. 不得因为用户填了邮箱或手机，就把两步验证算作已打开。

**已确认的两项决策：**

- **决策 B = B1**：登录流程中那个标题为「设置两步验证」、带跳过按钮的引导页，
  用户不跳过并完成绑定 → **算主动打开**，写 `enabled=true`。
  （账户中心的「添加验证方式」措辞不含开启语义，**不算**打开。）
- **决策 D = D2**：只有**已绑定**的因子（TOTP / 备份码 / passkey）才算"可用因子"。
  从没绑过因子的用户，开关**置灰不可开**，提示先添加验证方式。
  邮箱 / 手机**仅**作为已绑因子用户的备用验证通道保留（Package A 不动）。

---

## 1. 现状（prod-1 实测 2026-09-14，共 143,632 个用户）

| `mfa.enabled` | `skipMfaOnSignIn` | 有已绑因子 | 人数 | **登录真的会被要二次验证吗** | 开关现显示 |
|---|---|---|---:|---|---|
| (未设) | (未设) | 否 | **143,375** | **会** —— 只要有手机或邮箱（约 11.5 万人） | 开（**错**） |
| false | (未设) | 否 | 149 | 不会 | 开（**错**） |
| **true** | (未设) | **是** | **75** | **会** | 开（对） |
| false | (未设) | 是 | 20 | 不会 | 开（**错**，以为开了其实没开） |
| true | true | 是 | 11 | 不会 | 关（对） |
| false | true | 否 | 2 | 不会 | 关（对） |

**两个独立的错**：
- **显示错**：开关只读 `skipMfaOnSignIn`，没设过就显示"开" → 14.3 万人看到假状态。
- **行为错（更严重）**：14.3 万从没设置过两步验证的用户里约 **11.5 万**，只要走托管页登录
  就会被真实索要短信 / 邮件验证码 —— Logto 把 `primaryPhone` / `primaryEmail`
  **隐式**当作第二因子。这是真实强制行为，客户端放量前必须处置。

> 近 14 天 Logto 日志无任何 MFA 校验事件 → 这批账号目前基本走原生 token-exchange 登录
> （不经托管页），雷已上膛但尚未引爆。

## 2. 核心改造：判定公式统一为「显式开启」

### 2.1 新公式（展示 / API / 登录强制 三处共用同一函数）

```
两步验证已开启 = (mfa.enabled === true)
               ∧ (mfa.skipMfaOnSignIn !== true)
               ∧ (已绑因子非空)            ← 决策 D2：隐式邮箱/手机不计入
```

与上游 1.43 的差别只有两处：
1. 上游 `enabled` **未设 = 按"开"处理**（把老用户当已开）；我们改为 **未设 = 按"关"处理**。
2. 上游把隐式邮箱 / 手机计入"有因子"；我们（D2）只计已绑因子。

`∧ 已绑因子非空` 不是额外限制，而是与上游一致：`enabled=true` 但因子被删光时登录本就无法强制，
公式带上它才能保证"显示 = 行为"。

### 2.2 对存量用户的实际影响

| 人群 | 改前真实行为 | 改后真实行为 | 改后开关显示 |
|---|---|---|---|
| 75 人 `enabled=true` + 有因子 | 强制 | **强制（不变）** | 开 ✅ |
| 11 人 `enabled=true` + 已跳过 | 不强制 | 不强制（不变） | 关 ✅ |
| 20 人 `enabled=false` + 有因子 | 不强制 | 不强制（不变） | 关 ✅（今天错显示为"开"） |
| 149 + 2 人 `enabled=false` + 无因子 | 不强制 | 不强制（不变） | 关 ✅ |
| **143,375 人 `enabled` 未设 + 无因子** | 其中约 **11.5 万会被强制**（隐式手机 / 邮箱） | **一律不强制** | 关 ✅ |

**关键安全结论：没有任何一个用户会失去他主动开启过的两步验证。**
唯一被取消的强制，是系统从未征得同意、用户也不知情的那 11.5 万条隐式短信 / 邮件 2FA
—— 取消它正是口径 #5 的要求。

**"`enabled` 未设 + 有已绑因子"这一格人数为 0（已实测）**，
因此不存在"有人绑了因子、本来被强制、改后突然不被强制"的情况。

## 3. 必须堵住的两条「系统自作主张」写入路径

### 3.1 路径一：账户中心绑定因子自动开启（1.42 `d91696c70`）

`packages/core/src/routes/account/mfa-verifications.ts` 4 处调用点，绑 TOTP / 备份码 / WebAuthn
时写 `enabled=true`。**阶段一已就地摘掉**（见阶段一文档 §5）；本阶段沿用并纳入统一判定。

### 3.2 路径二：登录时静默回填 `enabled=true` ⚠️ 本次新发现

`packages/core/src/routes/experience/classes/mfa.ts` 的 `assertMfaEnabledOrSuggest`：

```
if (enabled === undefined) {
    if (userFactors.length === 0) → 抛出「设置两步验证」引导页
    markMfaEnabled()            → 静默写入 enabled = true，不问用户
    return
}
```

而这里的 `userFactors` 来自 `getUserMfaFactors()`，**包含隐式邮箱 / 手机因子**。

**后果**：那 11.5 万"只有手机或邮箱、从没绑过任何因子"的用户，
**只要有一次走托管页登录，Logto 就会静默把他的 `mfa.enabled` 写成 `true`**，
从此两步验证被永久打开 —— 而用户从未被问过。这正是口径 #1 要禁止的行为，且规模达 11.5 万。

- 该逻辑 **1.41 就已存在**，不是升级引入的（已对 v1.41.0 源码确认），
  所以它属于本阶段而非阶段一。
- 现网数据中不存在 `enabled=true` + 无已绑因子的用户 → 证明这条路径**尚未大规模触发**
  （与"这批用户走原生登录、不经托管页"的结论一致）。**上膛未击发，本阶段拆除。**

**本阶段动作**：改写该分支 —— `enabled` 未设时**不再回填**，一律按"关"解释，
是否提示用户由 §3.4 的引导策略决定。

### 3.3 写入侧最终权限表

| 入口 | 上游 1.43 行为 | 本方案 |
|---|---|---|
| 账户中心「添加验证方式」 | 自动写 `enabled=true` | **不写** ✅ 口径 #2 |
| 账户中心**两步验证开关** | 只写 `skipMfaOnSignIn` | **唯一权威入口**：开 = `enabled=true` + `skipMfaOnSignIn=false`；关 = `enabled=false` + `skipMfaOnSignIn=true` |
| 登录流程「设置两步验证」引导页完成绑定 | 写 `enabled=true` | **保持写 `true`** ✅ 决策 B1 |
| 登录时 `enabled` 未设的静默回填 | 写 `enabled=true` | **移除** ✅ §3.2 |
| 注册 provision | 写 `enabled=false` | 保持不变（与新公式一致，无害） |
| 删除最后一个因子 | 不回写 | **补 `enabled=false`**，避免"显示开、实际无法强制" |

### 3.4 引导页策略（避免给 14.3 万人制造新骚扰）

采纳 D2 后，若把"只计已绑因子"同时套用到**引导页判定**上，
那 14.3 万只有手机 / 邮箱的用户下次托管页登录都会看到一次「设置两步验证」引导页。

**决定：D2 的收紧只作用于「强制判定 + 状态展示」，不作用于「引导页是否弹出」。**

- 引导页判定继续沿用上游的 `getUserMfaFactors()`（含隐式因子）→ 这 14.3 万人**不会**被新增骚扰。
- 引导页本就带跳过按钮（跳过后写 `skipped=true`，永久不再提示），即使弹出也不会形成循环。
- 两者口径不同仅是内部实现细节，**对用户不产生任何不一致的可见状态**
  （引导页只是"建议"，不代表"已开启"）。
- 收益：本次改造对这 14.3 万人是**纯减负**（少了隐式强制 + 少了静默回填），零新增打扰。

## 4. 展示侧：不新增接口，扩展现有接口

> 回答"目前的两步验证状态 API 还要新增吗"：**不新增任何新端点。**

**现状问题**：我们的集成文档（backend `docs/integration/logto-sdk.md` §MFA、
`logto-account-api.md` §288）目前指引客户端用
`GET /api/my-account/mfa-verifications`（**已绑因子列表**）来显示两步验证状态。
在新口径下这是**直接错误的** —— 有因子 ≠ 已开启（现网就有 20 个用户属于这种情况）。

**方案**：沿用现有的 `GET /api/my-account/mfa-settings`，**只加字段、不加端点**：

| 字段 | 状态 | 含义 |
|---|---|---|
| `skipMfaOnSignIn` | 保留（兼容） | 原字段，语义不变 |
| `isEnabled` | **新增** | 两步验证是否真的生效（= §2.1 公式）→ **客户端改读这个** |
| `hasUsableFactor` | **新增** | 是否具备可用于二次验证的已绑因子（决定开关能否打开） |
| `usableFactors` | **新增** | 具体因子列表，供客户端展示 |

- `PATCH /api/my-account/mfa-settings` 新增可选入参 `isEnabled`；`skipMfaOnSignIn` 保留兼容。
- **纯增量，旧客户端不受影响**（继续读 `skipMfaOnSignIn` 不会报错，只是语义仍不准 → 需按下表迁移）。

**客户端迁移指引（跨仓，交由各自 agent 执行）**：

| 客户端当前做法 | 迁移动作 |
|---|---|
| 用 `/mfa-verifications` 列表非空判断"已开启" | ❌ 必须改 → 改读 `/mfa-settings` 的 `isEnabled` |
| 用 `/mfa-settings` 的 `skipMfaOnSignIn === false` 判断 | ❌ 必须改 → 改读同一接口的 `isEnabled` |
| 用 `/logto-configs` 原始 flag 自行推算 | ❌ 必须改 → 改读 `isEnabled` |
| 展示"已添加的验证方式列表" | ✅ 继续用 `/mfa-verifications`，语义本就正确 |

## 5. 判定侧：单一事实源

- 新增 `packages/core/src/libraries/user-mfa-state.ts`：由 SIE 设置 + 用户数据算出
  `usableFactors` / `hasUsableFactor` / `isEnabled`。
- `MfaValidator.isMfaRequired`、`GET /mfa-settings`、账户中心开关**全部消费同一函数**
  → 三者结构上不可能再漂移（调研文档 §2 的根因被消除）。

## 6. UI

- 账户中心 `MfaSection` 开关由 `skipMfaOnSignIn === false` 改绑 `isEnabled`。
- `hasUsableFactor = false` 时开关**置灰不可开**（决策 D2），提示复用现有
  `account_center.security.no_verification_method_warning` → **不新增 i18n key**。
- 已绑因子但开关为"关"的用户（现网 20 人）：开关可正常拨开，无额外阻碍。

## 7. 存量数据处理：不回填、不迁移、不发通知

按口径 #3，**一个用户的 `logto_config` 都不改**。

- 20 个"已绑因子但 `enabled=false`"的用户：**保持关**。今天看到的"开"是假的，
  改造后会诚实显示"关"；想开自己拨开关。
- 143,375 个 `enabled` 未设的用户：**不写入任何值**，由新公式按"关"解释。
- **不发通知邮件**：他们本就没有真正开启过，账户中心从此会如实显示；主动发信反而引发困惑。

## 8. 改动面

| 层 | 文件 | 性质 |
|---|---|---|
| 判定 | `core/src/libraries/user-mfa-state.ts` | **新增**（我方文件，升级零维护成本） |
| 判定 | `core/routes/experience/classes/libraries/mfa-validator.ts` | override，改为消费统一函数 |
| 写入 | `core/routes/experience/classes/mfa.ts` | override，移除 §3.2 的静默回填 |
| 写入 | `core/routes/account/mfa-verifications.ts` | override（阶段一已建），追加"删光因子回写 `enabled=false`" |
| 展示 | `core/routes/account/index.ts` | override（已有），扩展 `/mfa-settings` GET/PATCH |
| 展示 | `schemas/src/types/*`（响应 guard） | override，新增三个响应字段 |
| UI | `account/src/pages/Security/MfaSection/index.tsx` | **新增 override**（目前无此 override） |

### 8.1 ~~搭车项~~：我方 Account 写路由的 `assertFirstPartyClient` —— **已提前完成（2026-09-14）**

> **本阶段无需再处理此项。** 代码 `e561971`，镜像
> `nicematrix-logto:release-e56197125ec3f00d4760d11a4dc6448a050ff6cc-20260914-140410`，
> id-staging 单变量对照验证 17/17 全绿，prod-1（= 两区）已上线。
> 完整记录：`changelog/logto-first-party-account-writes-20260914.md`；
> 验证脚本：`docs/upgrade-1.43/smoke/smoke-first-party-account-writes.sh`。
> 下文保留作背景与验证口径。

升级复盘遗留项 #2（`upgrade-1.43/POST-UPGRADE-REVIEW.md` §4）。1.43 给**所有上游 Account API
写操作**加了 first-party 断言（`core/src/utils/assert-first-party-client.ts`：token 属于第三方
应用则 403），我方两个自写 override 没有：

| 文件 | 写操作 |
|---|---|
| `core/routes/account/avatar.ts` | `POST` / `DELETE /api/my-account/avatar` |
| `core/routes/account/deletion-request.ts` | `POST` / `POST …/confirm` / `DELETE /api/my-account/deletion-request` |

- **今天是纯 no-op**：prod-1 全部 22 个 application `is_third_party=false`，断言不可能命中。
  因此阶段一按「升级不改语义」未做，也**不值得为它单独重编译镜像 + 走一次 prod 部署**。
- **搭本阶段的车**：阶段二本来就要重出镜像，边际成本≈0，且补上后未来真接入第三方应用时
  自动拦住「第三方 token 改头像 / 发起销号」。
- 若阶段二被推迟，另一个触发点是**后台创建第三方应用**（勾 `is_third_party`）——那之前必须先补。
- 验证方式：prod 无第三方应用，故在 staging 临时建一个 `is_third_party=true` 应用取 token，
  断言四个端点返回 403，验完即删；第一方 token 路径回归 200。

- **不新增 i18n key**；若最终确需新增，按 `GLOBAL_I18N_STANDARD` 一次补齐全部 locale，禁止英文兜底。
- **不改 SIE 配置**、**不改登录方式**（`signIn.methods[email].verificationCode` 保持 `false`）。
- **不动 Package A 三层死锁防御**（`SwitchMfaFactorsLink` override、绑 passkey 后强制备份码、
  admin 紧急重置端点）。

## 9. 验证清单（staging 全绿才进 prod-1）

1. 新注册用户 → 开关"关"且**置灰**，登录不被要求二次验证。
2. 只有手机 / 只有邮箱的老用户（`enabled` 未设）→ 开关"关"，
   **登录不再索要短信 / 邮件验证码**，且**登录后 `logto_config.mfa.enabled` 仍未被写入**
   （§3.2 静默回填已拆除 —— 核心回归）。
3. 账户中心添加 TOTP → 开关**仍为"关"**，`mfa.enabled` 未被写入（口径 #2 核心回归）。
4. 承 3，开关此时**变为可拨**（`hasUsableFactor=true`）→ 拨到"开" →
   `enabled=true` + `skipMfaOnSignIn=false`；退出重登 → **真的被要求二次验证**。
5. 拨回"关" → 退出重登 → **不再被要求**；开关显示"关"。
6. 删除最后一个因子 → `enabled` 回写 `false`，开关显示"关"且置灰。
7. 走登录引导页完成绑定（决策 B1）→ 开关显示"开"，下次登录真的被要求。
8. 引导页跳过一次 → `skipped=true`，后续登录不再弹出（§3.4 回归）。
9. 已绑因子用户走 MFA 挑战页 → 邮箱 / 手机备用通道仍可用（Package A 回归）。
10. `GET /mfa-settings` 三个新字段与第 4、5、7 步的真实登录行为**逐一对齐**。
11. 旧客户端只读 `skipMfaOnSignIn` 时不报错（纯增量回归）。
12. 旧客户端用 `{skipMfaOnSignIn:false}` **开启**时：返回体如实报 `isEnabled=false`，
    `mfa.enabled` 不被写入，登录也确实不被要求 —— 三者一致。
    （2026-09-14 补。第 11 项只测了旧 body 的「关」方向，而三端 native 客户端
    实际发的是「开」方向；静默回填拆除后它只写一半状态，已无法开启。行为符合
    口径 #1，但对客户端是破坏性变更，故固化为回归项。客户端整改指令见
    nicematrix-system `handoff/mfa-explicit-optin-client-brief.md`。）

## 10. 兜底（口径 #4 的退路）

若验证中发现"显示 = 行为"仍无法 100% 保证，则退回**去掉开关**：
账户中心与客户端一并不展示两步验证状态，只保留"添加 / 管理验证方式"入口。

**但 §2 的判定公式改造与 §3 的两条自作主张路径无论如何都要堵** ——
那 11.5 万条隐式 2FA 与静默回填是真实行为，与开关是否保留完全无关。

## 11. 发布收尾：文档系统必须同步到最新

> **硬性要求：开发完成后必须更新对外文档站，不得残留旧内容误导客户端开发。**
> 本阶段直接改变了客户端读取状态的方式，文档陈旧的代价比阶段一更高 ——
> 现有文档正在**主动教错**（指引客户端用因子列表判断开关状态）。

文档站两个入口（两个 region 各一套，**都要更**）：

| 入口 | 内容来源 | 发布方式 |
|---|---|---|
| `m.ej-mobile.cn/docs/`（cn）<br>`m.nicematrix.com/docs/`（intl） | backend 仓 `docs/**.md` 静态文件，清单由 `apps/admin-web/src/shared/docs/manifest.ts` 驱动 | 随 **admin-web 部署**落到 webroot |
| `m.ej-mobile.cn/docs/api/`<br>`m.nicematrix.com/docs/api/` | `server.js` 的 `@api` 注释块 → `npm run docs:generate` → `docs/integration/openapi-docs.yaml` | 同上（`prebuild` 已强制跑 `docs:generate`） |

### 必须改的页面与具体内容

| 文档页 | 必须更新的内容 | 优先级 |
|---|---|---|
| `docs/integration/logto-sdk.md` §MFA | **当前指引客户端用 `GET /api/my-account/mfa-verifications` 显示两步验证状态 —— 新口径下这是错的，必须改掉**。新增 `GET /mfa-settings` 与 `isEnabled` / `hasUsableFactor` / `usableFactors` 说明；显式注明"因子列表非空 ≠ 两步验证已开启"，并附 §4 的迁移对照表 | **P0** |
| `docs/integration/logto-account-api.md` | §5 现写着"Logto v1.39 加入了统一 2FA toggle，可在 Account Center UI 一键开关 MFA" —— 与事实不符，**删掉重写**；补全 `/mfa-settings` GET/PATCH 的新字段与语义 | **P0** |
| `docs/integration/identity-auth.md` | 两步验证的产品口径：只有用户主动打开才算开启；添加验证方式 ≠ 开启；邮箱 / 手机不使开关可用（D2） | **P0** |
| `docs/integration/logto-account-api.md`（因子章节） | 删除最后一个因子会把两步验证置为关 | P1 |
| 若本阶段动了任何 backend 路由 | `@api` 注释块 + `npm run docs:generate` 重生 `/docs/api/` | 按实际 |

### 本仓内部文档（不上文档站，一并改）

- `docs/mfa-deadlock-prevention.md`：补充隐式因子在新口径下的适用范围（**仅限已绑因子用户**）。
- `docs/mfa-state-accuracy-20260909.md`：标注"已由本方案接替"。
- `logto-custom/README.md`：登记本阶段新增 / 修改的全部 override。

### 收尾步骤

1. 改 backend 仓对应 `docs/**.md`；若新增文档页，同步补 `manifest.ts` +
   `shared/i18n/locales/*.json` 的 `docs.title.<key>`（**全 locale，禁英文兑底**）+ `docs/README.md` 索引。
2. `cd apps/admin-web && npm run docs:check`（有路由变更时跑 `docs:generate`）—— OpenAPI 陈旧会阻断构建。
3. 按 `skills/admin-web-deploy`（3 个 Vite 入口）部署 intl；按 `skills/prod3-cn-deploy` 部署 cn。
   ❗ 部署前必比对「线上 admin 版本 → 待发版本」全差量（MEMORY 已记录过事故）。
4. **逐条验收线上页面**（不是看构建成功就算完）：
   `m.ej-mobile.cn/docs/` 与 `m.nicematrix.com/docs/` 上述页面内容为新版；
   `/docs/api/` 能正常渲染；强刷新确认无 CDN / 浏览器缓存残留。
5. **全文搜旧表述并确认零残留**，至少搜这几个关键词：
   `mfa-verifications`（是否还被当作状态源）、`skipMfaOnSignIn`、`v1.39`、`一键开关`。
6. 向各客户端 agent 发出交接说明（附 §4 迁移对照表 + 文档站链接），
   **跨仓代码由各自 agent 执行，本 agent 不动客户端仓库**。
