# Logto 1.40.1 → 1.41.0 升级后专项审查报告

**审查人:** nicematrix-system agent
**日期:** 2026-07-11(升级当天,prod-1 部署后数小时)
**范围:** staging (`id-staging.nicematrix.com`) + prod-1 (`id.nicematrix.com`)
**基线:** upstream v1.40.1 (3308305) → v1.41.0 (91e55698a),165 个上游提交;我们的 override 集 89 → 87 文件
**结论:** 升级总体正确、生产健康;发现 **1 个真实功能缺陷(P1,已定位、有修复方案、线上零流量未触发)** + 2 个低风险观察项。无安全泄漏。

---

## 1. 审查方法

1. **逐文件 diff 核验**:87 个 override 文件全部与 upstream v1.41.0 对应文件做三方对照(`git -C logto-upstream show v1.41.0:<path>` vs `logto-custom/overrides/<path>`),确认每个 delta 要么是我们有意保留的定制、要么与 upstream 完全一致。
2. **认证热路径重点审计**:token-exchange grant、oidc/init、TOTP 重放防护、验证码限流、search-parameters strip、account routes 逐行核对。
3. **运行时验证**:两环境容器状态 / 镜像 layer digest / DB alteration state / 新增列与索引 / app-access-control 实际启用状态 / 日志错误扫描。
4. **动态复现**:在部署镜像内用 node 直接跑 zod guard 复现响应体行为(见 §3)。
5. **CVE 对照**:确认 CVE-2026-55377、CVE-2026-55789 及相关上游安全提交(#9032 security-page env guard、#8908 in-page social unlink、ua-parser-js 2.0.10)全部随 upstream 流入镜像。

## 2. 核验通过项(证据摘要)

| 项 | 结果 | 证据 |
|---|---|---|
| token-exchange 3 参签名 + `assertUserHasApplicationAccessForOidc` | ✅ 与 upstream 一致,我们的 id_token/refresh_token 块完整 | 过滤 marker 后 diff 仅剩预期增量;staging+prod 实测返回 access+id+refresh 三 token |
| app-level access control 默认关 | ✅ 全部应用 `appLevelAccessControlEnabled` unset,规则表 0 行(两环境) | DB 查询 `applications.custom_client_metadata` / `application_access_control_user_relations` |
| `init.ts` Grant 365d | ✅ 唯一 delta 就是这一行,upstream 新增的 `loadExistingGrant`/`registerGrants` 完整保留 | diff 共 10 行,全部为注释+该行 |
| TOTP 重放防护 | ✅ `verifyUserExistingTotp` 与 upstream **逐字符一致**;品牌 issuer 只改 `generateSecretQrCode` | diff 输出 `REPLAY-LOGIC-IDENTICAL` |
| 验证码限流 `withMessageRateGuard` | ✅ 已吸收,`additional.ts` 仅剩 2 处品牌 issuer delta | diff 核对 |
| `search-parameters.ts` | ✅ upstream 新 `replaceState(window.history.state,…)` 保留,`captureNativeCapsFromUrl()` 在 strip 前 | diff 核对 |
| CVE-2026-55377 修复(Account Center step-up 绕过) | ✅ `canSkipVerification` / `hasSecurityVerificationMethod` 链路完整流入;SocialCallback override 已合并该路径 | grep 双侧核对 |
| DB alterations 9/9 | ✅ 两环境 `systems.alterationState` = `1782375106`(1.41.0 最后一条);新列/索引实测存在(`users.is_password_expired`、`username_policy`、`verification_code_policy`、`password_expiration`、`sentinel_activities__created_at`) | psql 查询 |
| 镜像一致性 | ✅ staging 与 prod layer digest md5 相同(`d6010708…`) | docker inspect |
| 运行健康 | ✅ 两环境容器 healthy、0 重启;部署窗口后日志零错误("undeployed alterations" 报错均发生在 alteration 执行前,属预期) | docker logs --timestamps |
| 被 DROP 的 2 个 override(SocialSection isApple、MfaSection scss) | ✅ 合理:upstream 已吸收/重构,delta 失去意义 | upstream 源码核对 |
| Home/App.tsx 合并(MfaVerificationsProvider + PasskeySection + Sessions 路由 + /profile /security 重定向) | ✅ 全部在位 | grep 核对 |
| sign-in-experience OSS `hideLogtoBranding` 放行 | ✅ 只放宽 Cloud-only assert;custom UI CSP 仍 Cloud-gated;quota 仅 Cloud 收 | diff 全文核对(仅 2 处 delta) |
| PasskeyBinding backup-code 防锁死 detour | ✅ 保留并叠加 upstream 变更 | diff 核对 |
| 回滚资产 | ✅ 镜像 tag(staging `pre-1.41-backup`、prod `pre-1.41-backup-20260711_1822`)+ 同会话 pg_dumpall(staging 11M / prod 138M)在位 | ls / docker images |

## 3. 发现的问题

### P1 — `avatar.ts` 未适配 1.41 `getScopedProfile` 新返回结构 → 头像上传/删除接口返回 500

**文件:** `logto-custom/overrides/packages/core/src/routes/account/avatar.ts`(我们自定义的 Account Center 头像路由)

**根因:**
upstream 1.41 把 `getScopedProfile()` 的返回值从 `Partial<UserProfileResponse>` 改成了 `{ profile, user }` 包装对象(为了给 `getAccountCenterFilteredProfile` 传第三参 `securityVerificationUser`,支撑 CVE-2026-55377 修复链路)。合并时 `account/index.ts` 的 3 个调用点都改了解构,但 **`avatar.ts` 的 2 个调用点(L111、L138)漏掉了**——仍把整个 `{profile, user}` 包装对象当 profile 传给 `getAccountCenterFilteredProfile`。

**实际行为(已在部署镜像内动态复现,非推测):**
1. `getAccountCenterFilteredProfile` 对包装对象解构,`profile` 字段取到的是完整 scoped profile(其内含嵌套 `profile` 对象),`...rest` 里混入了 **完整 DB user 行(含 `passwordEncrypted`)**。
2. koaGuard 的 zod response guard(`userProfileResponseGuard.partial()`)校验时在 `profile.profile` 处类型不匹配(期望 string,收到 object)→ `safeParse` 失败 → 抛 `ResponseBodyError`(HTTP 500)。
3. 因为 guard 失败即抛错、不返回 body,所以 **`passwordEncrypted` 不会出网——无安全泄漏**。但这只是被最后一道 zod guard "碰巧"挡住;响应对象本身已经装入了密码哈希,任何放宽 guard 的后续改动都会直接变成泄漏。

**用户可见影响:**
- `POST /api/my-account/avatar`:头像**实际已写入 DB**(updateUserById 在构造响应之前执行),但接口回 500 → 前端 AvatarEditor 弹 "上传失败" toast、不调 `refreshUserInfo()`。用户看到失败,刷新后却发现头像已换——体验错乱。
- `DELETE /api/my-account/avatar`:同样删除成功但回 500。
- **线上零触发**:两环境日志中 `my-account/avatar` 自升级以来请求数为 0,尚无真实用户受影响。

**为什么 smoke 没抓到:** 1.41 冒烟清单只做了 curl 层的路由存在性/鉴权检查,没有带真实 user token 完整走一次头像上传。1.40 时代该接口是好的(旧返回结构),回归恰好落在 override 与 upstream 的接缝上。

**修复方案(2 行,无迁移、无 API 契约变化):**
`avatar.ts` 两处调用改为解构:

```ts
// L111 与 L138,原:
const profile = await getScopedProfile(queries, libraries, scopes, userId);
// 改为:
const { profile } = await getScopedProfile(queries, libraries, scopes, userId);
```

(可选一致性增强:同 upstream `index.ts` 一样把 `user`/`updatedUser` 作为第三参传给 `getAccountCenterFilteredProfile` 以带上 `hasSecurityVerificationMethod`;非必需,前端不消费该字段。)

**修复步骤(标准流程,High-risk 生产段需确认):**
1. 分支 `fix/avatar-1.41-scoped-profile`;改 `logto-custom/overrides/.../avatar.ts` 两行。
2. `docker compose build` → tag `nicematrix-logto:avatar-fix-<date>`;确认镜像内 build 产物含修复。
3. staging 部署(force-recreate)→ 冒烟:**带真实 user token 实际上传一张头像 + 删除**,确认 200 + 响应体为过滤后的 profile;回归 token-exchange 三 token、/account 三页 200。
4. Xianglin GO 后 prod-1:retag backup → docker save|ssh|load(md5 校验)→ force-recreate → 同套冒烟。无 DB alteration。
5. 更新 `docs/patches.md` + workspace changelog;LOGTO_VERSION 不变(仍 1.41.0)。

**回滚:** 纯镜像回滚(`pre-1.41-backup*` 或本次修复前的 latest retag),无数据影响。

### P2(低)— `avatar.ts` DELETE 路由 status 白名单缺 500

`status: [200, 400, 401]` 未含 500,storage/内部错误时 koaGuard 在生产只 warn 不抛,但开发环境会抛 StatusCodeError 掩盖真实错误。随 P1 一并把两个路由的 status 列表对齐(POST 已含 500)。顺手修,不单独发版。

### 观察项(无需行动)

- **Sessions 页可见性**:`account_centers.fields.session = "Off"`(两环境),所以 Sessions 标签页对用户隐藏;`/account/sessions` 的 200 是 SPA 兜底。changelog 里 "Sessions page live" 指路由/代码在位。若要对用户开放,在 Console 把 session 字段置 ReadOnly/Edit 即可,属产品决策。
- **SMTP2GO connector**:已 link、未配置,符合预期。

## 4. 总体评估

- 合并质量高:20 个 3-way merge 中 19 个完全正确,唯一疏漏是 `avatar.ts`——它不在 upstream CHANGED 列表里(我们自有文件,drift 工具标为 "OUR-NEW passthrough"),但它 **消费了** 一个 upstream 改了签名的内部函数。这是本次的方法论教训:
  > **教训(已纳入未来升级流程):** drift 工具只对比 override 文件本身与 upstream 的差异,无法发现"我们自有文件调用了 upstream 变更签名的函数"这类接缝回归。下次升级需追加一步:对所有 OUR-NEW 文件 grep 其 import 的 upstream 内部模块,凡被 upstream 改动过的,人工核对调用点。
- 安全面:两个 CVE 修复完整流入;app-access-control 默认关且实测 no-op;无新增暴露面;P1 缺陷无泄漏路径(zod guard 兜底 + 线上零流量)。

## 5. 状态

- **P1/P2 修复:** ✅ 代码已修(2026-07-11)。`avatar.ts` L112/L138 改为 `const { profile } = await getScopedProfile(...)`,并同 upstream `index.ts` 模式把 `updatedUser` 作第三参传入 `getAccountCenterFilteredProfile`(响应带 `hasSecurityVerificationMethod`,与 PATCH profile 路由行为一致);DELETE 路由 status 白名单补 `500` 与 POST 对齐。
- 部署状态见本目录 `FIX-DEPLOY.md`(staging 冒烟 → prod-1)。
- 本报告随 repo 提交,路径 `docs/upgrade-1.41/POST-UPGRADE-REVIEW.md`。
