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
  → fan-out 到所有已启用 PostSignIn hook（可被 §6.5 region 路由收窄）：
      • POST https://api.nicematrix.com/v1/webhook/logto      (prod-1, 处理 region=intl)
      • POST https://apiv3.ej-mobile.cn/v1/webhook/logto      (prod-3, 处理 region=cn；S3c 待 cn 上托管登录时注册激活)
  → 各后端按 region 自筛：非本区 200 ignored，本区跑 applyDeviceLoginControl
```

## §6.5 Logto 端 region 路由（fan-out 过滤，2026-06-08）

后端自筛（S3b）已保证正确性，但默认 fan-out 仍把**每个** PostSignIn 事件发给**所有** hook（非本区后端 `200 ignored` 丢弃）——intl 登录事件仍会出网到 prod-3、反之亦然。本 override 让 hook **声明自己负责的区**，Logto 只投递匹配事件，从源头闭环数据驻留。

- 改动文件（**第 7 个** override，`[NiceMatrix]` 标记）：`core/src/libraries/hook/index.ts` —— `triggerInteractionHooks` 的 PostSignIn fan-out filter 增加 `hookMatchesRegion(hook, region)`。
- **区标签载体** = `config.headers['x-nicematrix-region']`（值 `intl`/`cn`）。选 headers 是因为它是开放的 `z.record(z.string())`，**能通过 config 读取层的 zod guard**（顶层自定义字段会被 strip），无需改 schema；副作用仅是作为 HTTP header 发出（后端忽略未知 header）。
- **匹配口径与后端字节一致**：payload `region` 缺省/空 → `intl`；`cn`/`intl` → 该区；未知值 → 不匹配任何 tag。
- **无标签 hook = region-agnostic = 收全部事件**（历史单 hook 行为）。→ **prod-1 hook 保持不打标签 = 投递与今日字节一致，零回归**；路由仅在「给 hook 打标签」后才生效。
- 仅路由 PostSignIn；其它 interaction 事件（PostRegister/PostResetPassword）与 data hook（`User.Deleted`）不受影响、保持全局。

> 升级 sync 时本 override 与下方 6 文件 ExtraParam 链同属一条链，合计 **7 个 override 文件**。

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

### Region routing activation（S3c）— ✅ 已激活 2026-06-08

> **状态：已激活（2026-06-08 11:28 MDT，Xianglin 批准）。** prod-1 hook `9aiz0tmuqb834vpu1nkcx` 已打 `intl` 标签；第二个 cn hook `3wswwkcjxlh4snzrwcc3t`（PostSignIn → `https://apiv3.ej-mobile.cn/v1/webhook/logto`，`x-nicematrix-region: cn`）已注册+enabled，签名密钥 = prod-3 `LOGTO_WEBHOOK_SIGNING_KEY`（字节一致校验过）。激活后验证：prod-3 接受签名 `region:cn` 事件（零变更探针 → `app not found`）、丢弃 `region:intl`（`other-region, self:cn`）、坏签名 401 fail-closed；prod-1 镜像验证（接受 intl、丢弃 cn）；Logto healthy + OIDC 200。
>
> **重要（native vs 托管管线）**：native 社交登录（wechat/qq/alipay）走 RFC-8693 token-exchange grant，**不触发 PostSignIn webhook**（`oidc/grants/token-exchange/index.ts` 零 hook 引用）；设备管控由后端同步 `applyNativeLoginControl` 在 native 路径内完成。本 hook **只服务托管页登录**（interaction/experience 流，`koa-experience-interaction-hooks.ts` 组装 `deviceRef`/`region` payload）。故在 cn 真正上托管页登录前，cn hook 不会收到有机事件（但管线已就绪，上线即生效，无需再改）。
>
> 以下为当时执行的两步步骤（保留作轨迹 / 回滚参考）。回滚 = 删除 cn hook `3wswwkcjxlh4snzrwcc3t` + 清除 prod-1 hook 的 `x-nicematrix-region` header（恢复 region-agnostic）。

原设计：今天 cn = 100% native（prod-3 本地强制 `applyNativeLoginControl`），托管登录仅 intl 走现有单 prod-1 webhook。两步激活（同一 Logto，跨境共用 `id.nicematrix.com`；hooks 在 `admin` tenant）：

**步骤 1 — 给现有 prod-1 hook 打 intl 标签**（先做，避免给 cn hook 前出现“两 hook 都收 intl 事件被各自处理两次”窗口）：
```sql
-- 在 nicematrix-id-postgres 容器内（prod-1）
update hooks
   set config = jsonb_set(config, '{headers,x-nicematrix-region}', '"intl"')
 where id = '9aiz0tmuqb834vpu1nkcx';
```
打标签后该 hook 只收 `region=intl`（及缺省）事件；cn 事件不再投到 prod-1。

**步骤 2 — 注册第二个 cn hook（带 cn 标签）**：
- 事件: `PostSignIn`
- 地址: `https://apiv3.ej-mobile.cn/v1/webhook/logto`
- `config.headers`: `{ "X-Webhook-Source": "logto", "x-nicematrix-region": "cn" }`
- 签名密钥: prod-3 `/etc/nicematrix/backend.env` → `LOGTO_WEBHOOK_SIGNING_KEY`（已配，与 prod-1 hook **各自独立、互不影响**）。
- enabled: true。
```sql
insert into hooks (tenant_id, id, name, event, events, config, signing_key, enabled)
values ('admin', '<21-char-nanoid>', 'NiceMatrix Login Control (cn)', null,
        '["PostSignIn"]'::jsonb,
        '{"url":"https://apiv3.ej-mobile.cn/v1/webhook/logto","headers":{"X-Webhook-Source":"logto","x-nicematrix-region":"cn"}}'::jsonb,
        '<prod-3 LOGTO_WEBHOOK_SIGNING_KEY>', true);
```

**激活后验证**：cn 托管登录（带 `region=cn`）→ 只 prod-3 收到、跑 `applyDeviceLoginControl`，prod-1 不再收到 cn 事件；intl 托管登录（`region=intl`/缺省）→ 只 prod-1 收到。回滚 = 删除 cn hook + 清除 prod-1 hook 的 `x-nicematrix-region` header（恢复 region-agnostic）。

---

## 区域感知的三方登录按钮显隐：`hide_social` / `show_social`（2026-06-17）

> 用途：让客户端 / 业务 App 控制 Logto 托管登录页**显示哪些三方登录按钮**。典型场景：中国区构建包隐藏 Google / Facebook。

### 两个参数（正交于 `native_caps`）

| 参数 | 语义 | 例 |
|------|------|----|
| `hide_social=<csv>` | 黑名单：列出的 target 隐藏，其余照常显示 | `?hide_social=google,facebook` |
| `show_social=<csv>` | 白名单：只显示列出的 target，其余全部隐藏 | `?show_social=apple,wechat` |

二者可单用、可并用，可都不传。**都不传 = 与上游字节级等价**（PC / intl / 不带参数完全不受影响）。

并用时的优先级（确定性）：
```
visible = (show 缺省 或 target ∈ show) 且 (target ∉ hide)
hidden  = ¬visible
```
即 `show` 定义可见全集（白名单），`hide` 再从中扣除。`show_social=`（空值）= 隐藏所有三方（fail-safe）；`hide_social=`（空值）= 空黑名单（no-op）。

`<csv>` 每项是三方连接器 target（小写：`google` / `facebook` / `apple` / `wechat` / ...），不合法形状（含空格/控制符/超 64 字符）静默丢弃。

### 护栏（结构性，非黑名单）

**只能影响三方按钮，永远无法隐藏邮箱 / 密码 / 用户名主登录**。原因：主登录方式属于 `signIn.methods` 数组，过滤逻辑只作用于 `socialConnectors` 数组，物理上拿不到主登录方式 —— 护栏是结构性的，不依赖任何关键字列表。

### 改动文件（4 个 override + 1 新建）

所有改动标 `[NiceMatrix]` 注释。

| # | 文件 | 改动 |
|---|------|------|
| 1 | `packages/schemas/src/consts/oidc.ts` | `ExtraParamsKey` 加 `HideSocial`/`ShowSocial` + zod guard + 类型 |
| 2 | `packages/core/src/oidc/utils.ts` | `buildLoginPromptUrl()` 增 2 个 `appendExtraParam`（让参数穿过 `/oidc/auth → /sign-in` 重定向到达 SPA） |
| 3 | `packages/experience/src/utils/native-caps.ts` | 新增 `readSocialVisibilityRule()` / `shouldHideSocialTarget()` 纯函数 + capture 两个新参数到 sessionStorage |
| 4 | `packages/experience/src/utils/sign-in-experience.ts`（**新 override**） | 在上游平台过滤之后追加 `shouldHideSocialTarget` 过滤；google 被隐藏时同时 `googleOneTap=undefined`（避免 One Tap 卡片绕过隐藏） |

> **为什么过滤点放在 `sign-in-experience.ts` 而非 `SocialSignInList`**：`socialConnectors.length` 同时驱动 SignIn/Register 页那条 “**or**” 分隔线与若干空态分支。只在 `SocialSignInList` 内部过滤会在白名单清空列表时留下**孤儿分隔线**。`parseSignInExperienceResponse` 是所有消费方（分隔线判断 / SocialSignInList / DirectSignIn / web callback 解析）读取连接器列表的**唯一入口**，在此过滤一处生效、全局一致、无回归。

### 数据流

```
客户端 signIn(?hide_social=google,facebook 或 show_social=...)
  → /oidc/auth（oidc-provider 默认会剥离非标准参数）
  → buildLoginPromptUrl 用 appendExtraParam 显式转发
  → /sign-in?hide_social=...（experience SPA）
  → handleSearchParametersData() → captureNativeCapsFromUrl() 写入 sessionStorage 并清理 URL
  → getSignInExperienceSettings() → parseSignInExperienceResponse() 按规则过滤 socialConnectors
  → 登录页只渲染可见三方按钮
```

> 纯前端显隐：`/.well-known/experience` 响应**仍包含**被隐藏的连接器（只是不渲染）。这是有意选择 —— 满足"区域差异化按钮"诉求且不触碰服务端配置（决策：Xianglin，2026-06-17）。

单元测试：`logto-custom/tests/test-native-caps.js`（`bash logto-custom/tests/run.sh`）。
