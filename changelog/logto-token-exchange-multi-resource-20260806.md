# Logto token-exchange multi-resource (2026-08-06)

## Incident

CN clients added `resource=https://api.nicematrix.com` (store) alongside the
business resource `https://apiv3.ej-mobile.cn`. Native (wechat/alipay/qq) logins
then entered a forced re-login loop.

Measured on prod-1 Logto audit log (2026-08-06):

| app | invalid_target | users | re-logins (baseline) | revokes (baseline) |
|---|---|---|---|---|
| nicelist `yfcr5h18kx5ml6lco68ms` | 53 | 15 | 53 (~13) | 51 (~8) |
| nicerecorder `fnegb39eoma7riuamjm8z` | 5 | 1 | 12 | 8 |
| nicenote `wgooa3e48a5l830v97x7a` | 0 today, 2 on 08-05 | — | 5 | 3 |

nicelist refresh errors by day: 08-01 16 → 08-04 74 → 08-05 91 → **08-06 384**
(280 `refresh token not found` + 53 `invalid_target` + 49 `already used`).

**Not app-specific.** nicenote simply sent no store request that day; nicerecorder
had only one such user. All three share the same defect.

## Root cause

`logto-custom/overrides/.../token-exchange/index.ts` minted the refresh token with
`resource: params.resource` — a **single** value. oidc-provider then rejects any
other target on refresh:

```
resolve_resource.js: if (resource && !model.resourceIndicators.has(resource)) throw new InvalidTarget()
base_token.js:       get resourceIndicators() { return new Set(Array.isArray(this.resource) ? this.resource : [this.resource]) }
```

Proof it is the RT shape and nothing else:
- RT store-wide: token-exchange → 2406 rows, **0** arrays. authorization_code →
  890 strings + **117 arrays** (authorize can declare several resources).
- User `ii1r0gcbut29` (nicerecorder) looped 4× via native login, then at 16:43
  the client switched to a hosted-page login declaring **both** resources and the
  store refresh succeeded at 16:45 and 17:50 — **zero server-side change**.

Secondary damage: clients treated `invalid_target` as a dead session → `RevokeToken`
→ whole grant killed → other devices' RTs became `not found` → re-login → repeat.
Self-sustaining loop, not sporadic.

Unrelated to the prod-1 `slug` drift (`easychecker` vs `nicelist`): the refresh path
never reads `applications.slug`; store auth resolves by `logto_client_id`.

## Fix (plan B1) — 1 file, 3 marked blocks

1. Normalize `params.resource` → `requestedResources: string[]`; `[0]` is primary
   and stays the access token's single `aud`.
2. Feed `resolveResource` a shallow proxy pinning `params.resource` to the primary.
   **Critical**: given an array it calls Logto's `defaultResource()`, which ignores
   its candidates and returns the tenant default → would silently mint the WRONG
   audience. Single-resource requests bypass the proxy entirely.
3. Register secondaries on the grant (`getResourceServerInfo` + `addResourceScope`);
   `refresh_token` derives scope from `grant.getResourceScopeFiltered()`, which
   returns '' for unrecorded resources. Unknown indicator → `InvalidTarget` at
   login (fail-fast) instead of a useless RT.
4. Persist `resource: requestedResources.length > 1 ? requestedResources : primary`.

`resource` was already a duplicable grant parameter (`registerGrants()` →
`getParameterConfig`); only the handler ignored it.

## Single-resource regression (explicitly asked)

**No impact.**
- Stored RTs are never rewritten (nicerecorder 1615 / nicenote 1067 / nicelist 619
  all remain `string`).
- 618/618 token-exchange calls in the prior 30d sent one string → `requested[0]`
  branch, byte-identical to `params.resource`.
- `resourceIndicators` getter already normalized both shapes.
- Rotation copies `resource: refreshToken.resource` verbatim.
- Both indicators expose 0 scopes → AT scope `''` either way.
- `organization_id` branch untouched.

## Client contract (must ship together)

- Send `resource` twice on the token-exchange request.
- **`invalid_target` must never trigger RevokeToken** — configuration error, not an
  expired session. Degrade to "store unavailable", keep the session. This reflex
  *was* the loop.

## Status

- Code + 13-case unit test (`test-token-exchange-multi-resource.js`, wired into
  `run.sh`) done; full suite green (36+5+7+6+13).
- Docs updated: `logto-custom/README.md`, backend `identity-auth.md`,
  `logto-sdk.md`, `cloud-storage-api.md`.
- API VERSION 1.2.485 → 1.2.486 (docs-only backend change).
- **Not built, not deployed.** Next: image rebuild → id-staging real-token smoke
  (single-resource regression + dual-resource path) → prod-1. prod-3 shares prod-1
  Logto cross-border, so no cn-side Logto deploy.
- Planned image tag: `:token-exchange-multi-resource-20260806`.

## Build + staging verification (2026-08-06)

**Proxy invariant bug caught by staging, not by unit tests.** First implementation
passed a `Proxy` ctx to `resolveResource` → 500 `server_error`:
`TypeError: 'get' on proxy: property 'oidc' is a read-only and non-configurable
data property`. oidc-provider defines `ctx.oidc` non-configurable/non-writable,
so the ES proxy invariant forces a `get` trap to return that exact object —
returning a wrapper (the entire point) always throws. Unit tests exercise the
extracted pure branches, not a real koa ctx, so they could not see it.

Fix: `Object.create` prototype shadowing (no such invariant; keeps the full
prototype chain, shadows only `params`, leaves caller's ctx unmutated). +3 test
cases (16 total), one asserting the Proxy form throws so it can't regress.
Commits: `b272a05` (fix), `6c523d3` (README).

Images: `nicematrix-logto:token-exchange-multi-resource-20260806`
- first (broken proxy) sha `17ec88e62c9e`
- final sha `d12c68dd3224`
- rollback tag `nicematrix-logto:pre-multi-resource-20260806` sha `955ff9c7fab5`

Build note: run via `systemd-run --unit=...` — plain `nohup`/`setsid` docker
builds get killed when the shell session is reaped (first attempt died with
"context canceled" ~30 min in). Build takes ~40 min.

Staging deploy note: `deploy/.env` does not exist; the real env file is
`/etc/nicematrix/id.env` → `docker compose --env-file /etc/nicematrix/id.env -p
nicematrix-id up -d logto`. Without it compose fails with "no port specified".
Test app needs `customClientMetadata.allowTokenExchange=true` (not `grantTypes`).

### id-staging smoke matrix — ALL PASS

| # | case | result |
|---|---|---|
| A | dual-resource token-exchange | 200, aud = primary, id_token + refresh_token |
| B | refresh for SECONDARY resource | 200, aud = secondary — **production bug fixed** |
| C | single-resource token-exchange | 200, RT stored as bare **string** (regression) |
| D | single-resource refresh | 200, aud correct (regression) |
| E | single-resource RT → other resource | invalid_target, still correctly rejected |
| F | unknown secondary at login | invalid_target, fail-fast as designed |

RT rows: multi = jsonb array (both indicators, preserved across rotation);
single = jsonb string. Zero `server_error` in container log; container healthy.
Throwaway app `1h2c9yqfh5g7tb5tuax7u` + user `xqnrccw2xyii` deleted after (0 residue).

**Status: staging verified, prod-1 NOT deployed** (awaiting explicit approval).
CN needs no separate deploy: prod-3 has no Logto container and `id.ej-mobile.cn`
302-redirects to `id.nicematrix.com`, so prod-1 covers both regions.

## prod-1 deploy (2026-08-06 ~12:00 UTC) — DONE, verified

Approved by Xianglin. Deployed to prod-1 (`46.224.6.74`, `id.nicematrix.com`).
CN needs nothing: prod-3 has no Logto; `id.ej-mobile.cn` 302 → `id.nicematrix.com`.

Method (prod-1 has NO dev repo / no git; compose lives in a runtime path):
- compose = `/var/www/nicematrix-id/deploy/docker-compose.yml` (found via container
  label `com.docker.compose.project.config_files`; `/root/projects` does not exist).
  env = `/etc/nicematrix/id.env`. Image line is pinned to `nicematrix-logto:latest`,
  so deploy = load image + retag `:latest` + `compose up -d logto`.
- `docker save` → rsync (`--partial --inplace`) → `docker load`. md5 identical on
  both ends (`909963152244587726c3a51e39d3ccfc`). gzip was pointless (315M→314M).

**Pre-deploy regression guard:** prod-1 was running `profilefields-fix-20260715`,
a lineage NOT present on staging. Verified both prod-only fixes are ancestors of
the new HEAD (`8e18cd6` profileFields, `984728a` avatar getScopedProfile) AND
present in the built bundle before switching `:latest` — otherwise this deploy
would have silently reverted them.

**Image ID differs after save/load** — expected, not drift: `d12c68dd3224` (build
host) vs `adc7aec93957` (prod). `save`/`load` drops the multi-arch manifest-list
wrapper. Proved same content by comparing `RootFS.Layers` on both hosts →
identical (`e205d26c98b28b3226d9cf4299581181`).

Rollback anchor on prod-1: `nicematrix-logto:pre-multi-resource-20260806` =
`238b2fd04473` (= old `:latest` = `profilefields-fix-20260715`).
Rollback = `docker tag …:pre-multi-resource-20260806 …:latest && compose up -d logto`.

### prod-1 smoke, real resource pair (apiv3.ej-mobile.cn + api.nicematrix.com) — 6/6 PASS
A dual-resource exchange → 200, aud=biz, RT present
B refresh for SECONDARY (store) → 200, aud=store   ← **the incident, fixed in prod**
B2 rotated RT back to biz → 200, aud=biz (alternating works, real client pattern)
C single-resource exchange → 200 (regression) · D single refresh → 200 (regression)
E single RT → other resource → invalid_target (still correctly rejected)
F unknown secondary → invalid_target (fail-fast)
RT rows: 3× array (both indicators, preserved across rotation) + 3× string.

Post-deploy: container healthy, bundle hash changed `Y4EDOKDC`→`G3J3TS37`,
`server_error` = 0, oidc-config 200 / api-status 204 / jwks 200.
**Real-app `invalid_target` since cutover = 0** (the only 2 were my own throwaway
app `ijwym55he73b8ot437w7c`, cases E/F by design). Throwaway app + user deleted,
0 residue; `/root/logto-mr.tar` removed.

### Remaining (NOT fixed by this deploy) — client-side
`fnegb39eoma7riuamjm8z` (nicerecorder) still logs `refresh_token not found` every
~30s: pre-existing damage from grants revoked BEFORE the fix. Those users must
re-login once; the retry loop will not self-heal. Client still must:
1. send `resource` twice at native login (it currently sends none/one), and
2. NEVER call RevokeToken on `invalid_target` (degrade to "Store unavailable").
Until (1) ships, apps keep getting single-resource RTs and store calls stay broken.

## Post-deploy field report: nicerecorder cn `oidc.invalid_token` (2026-08-06 20:36 CST)

User `ii1r0gcbut29`, app `fnegb39eoma7riuamjm8z`, ip 183.160.123.165, `Dart/3.9`.
Not a server regression — **client-side item (1) is still unshipped**.

Exact chain (prod-1 audit log, CST):
```
20:34:30 login (hosted page) → /oidc/auth resource=https://apiv3.ej-mobile.cn  ← ONE resource only
20:34:34 AuthorizationCode  200
20:34:36/37 RefreshToken (biz / none) 200
20:35:51 RefreshToken resource=https://api.nicematrix.com → 400 InvalidTarget   ← store not in grant
20:36:12 RevokeToken       (client reflex on invalid_target) → whole grant killed
20:36:12 RefreshToken → "refresh token already used"
20:36:13 GET /api/my-account 401 · POST /oidc/me 401 → app shows oidc.invalid_token
20:36:16+ RefreshToken every ~30s → "refresh token not found" (self-inflicted loop)
```
Same loop already at 20:15:55, 20:23:37, 20:31:11 → re-login each time (4 cycles/40 min).

Since cutover (12:00 UTC), prod-wide InvalidTarget = 6: 4 = this user, 2 = my throwaway
app `ijwym55he73b8ot437w7c` (cases E/F, by design). No other app affected.

**Why the server fix does not cover this path.** The fix registers secondary resources on
the grant when they are *declared at login*. This client logs in via authorization_code
with a single `resource`, so the grant carries only `apiv3.ej-mobile.cn`; asking for
`api.nicematrix.com` on refresh is correctly rejected (fail-fast, case F). The fix removes
the *server* defect (RT could not hold >1 indicator); it cannot invent an indicator the
client never requested.

**Client must ship both, neither is optional:**
1. Declare BOTH resources at login — `/oidc/auth?...&resource=https://apiv3.ej-mobile.cn&resource=https://api.nicematrix.com`
   (and identically on token-exchange). Currently only the biz resource is sent.
2. `invalid_target` MUST NOT trigger RevokeToken. Degrade to "store unavailable", keep the
   session. This reflex is what converts a 400 into a dead session + forced re-login.

Until (1) ships the store call keeps failing; until (2) ships every failure also destroys
the user's session on all devices.

## Correlation with "logged in on old build, then updated" (confirmed)

Xianglin's description matches the audit log exactly. Decisive contrast, same user
`ii1r0gcbut29`, same server, same day — only the **login-time `resource` declaration** differs:

| CST | `/oidc/auth` resource param | store refresh (`api.nicematrix.com`) |
|---|---|---|
| 15:52, 16:43–16:45 | **array** `[apiv3.ej-mobile.cn, api.nicematrix.com]` | 16:45:31 **200**, 17:50:31 **200** |
| 18:47 onward (18:48, 19:25, 20:14, 20:22, 20:30, 20:34) | **string** `apiv3.ej-mobile.cn` | 18:51:58, 19:53:05, 20:15:55, 20:23:37, 20:31:11, 20:35:51 → **400 invalid_target** |

Per-cycle shape after a single-resource login:
```
18:48:25 AuthorizationCode 200        (grant gets ONE indicator: apiv3)
18:48:28/31 RefreshToken (biz) 200
18:51:58 RefreshToken resource=api.nicematrix.com → 400 invalid_target
18:52:18 RevokeToken → grant destroyed → session lost → oidc.invalid_token on /oidc/me,/api/my-account
```
Repeats 19:53 · 20:16 · 20:24 · 20:31 · 20:36 — 6 forced re-logins in ~2h.

DB confirms the two grant lineages (`oidc_model_instances`, model `RefreshToken`):
- `mEOn2IDCNfT7` → `resource` = jsonb **array** (both indicators, preserved across rotation)
- `m3z0KDCZgbhe` / `ynEOoY-wGlxC` / older → `resource` = jsonb **string** (apiv3 only)
All of today's RTs are absent (RevokeToken deletes them) → the 30s `refresh token not found` loop.

### Exact throw site
`oidc-provider/lib/helpers/resolve_resource.js:29`
```js
if (resource && !model.resourceIndicators.has(resource)) throw new InvalidTarget();
```
`model` = the presented RefreshToken; `resourceIndicators` = Set built from its stored
`resource`. Called from the refresh_token grant handler (`packages/core/build/main-*.js:5002`).
The later `oidc.invalid_token` 401s come from bearer validation on `/oidc/me` and
`/api/my-account` **after** the client revoked its own grant — a downstream symptom, not the fault.

### Consequences (both must be handled client-side)
1. **A resource indicator cannot be added to an existing grant.** Every user who logged in on
   the old build carries a single-indicator RT; the server fix cannot retro-add store to it.
   Recovery = one fresh login that declares both resources. Unavoidable, by OIDC design.
2. **The build running right now still declares only one resource at `/oidc/auth`** (every login
   from 18:47 onward is a string). The array appeared only at 15:52 and 16:43–16:45 — a test
   build. So re-login with the current build does NOT fix store either.
3. `invalid_target` must never trigger RevokeToken. Without that reflex the user would merely
   lose the store feature; with it, every attempt kills the session on all devices.

## nicelist field report — "微信登录后重进 App 丢登录态" (2026-08-06 21:44 CST)

App `yfcr5h18kx5ml6lco68ms` (nicelist), user `k12kh936jbqy` (identity = **wechat**).
Server side is correct; this is **client item (1) still unshipped on the token-exchange path**.

Decisive shape stats (prod-1 audit log):
| path | 30d | shape |
|---|---|---|
| `Interaction.Create` (`/oidc/auth`, hosted page) | 113 array + 38 string | client DID start sending both resources here |
| `ExchangeTokenBy.TokenExchange` (native wechat/alipay/qq) | **208 string, 0 array** | still ONE resource — never fixed |

So the client shipped the dual-`resource` declaration only on the hosted-login path.
Native social login goes subject_token → token-exchange, and that request body is still:
`resource=https://apiv3.ej-mobile.cn` only → the grant is minted with a single indicator.

Observed cycle (repeats every ~2 min, 21:38 / 21:40):
```
21:38:42 Interaction.Create   resource=[apiv3, api.nicematrix.com]   ← array (irrelevant, wechat doesn't use this grant)
21:39:07 TokenExchange        resource="https://apiv3.ej-mobile.cn"  ← STRING, grant gets 1 indicator
21:39:13 RefreshToken (none)  200
21:39:22 RefreshToken resource=https://api.nicematrix.com → 400 invalid_target
21:39:38 RevokeToken   ← client reflex, kills the whole grant → 登录态丢失
21:39:52 RefreshToken → "refresh token not found" (loop)
```
Blast radius last 10h: nicelist 41 invalid_target / 12 users / 43 RevokeToken;
nicerecorder 11 / 1 user / 15 RevokeToken. No other real app affected.
Counter-proof same app/day: user `nisbc1bljmqu` logged in via **hosted page** (array) →
RT stored as jsonb array, store refresh 200, no logout.

**Two client fixes, order of impact:**
1. (stops the logout immediately) `invalid_target` MUST NOT trigger RevokeToken — degrade to
   "云同步不可用", keep session. Without the revoke the user only loses store, never the login.
2. (restores store) send `resource` **twice on the token-exchange request body**, not just on
   `/oidc/auth`. Users already holding single-indicator RTs must re-login once afterwards.

## nicerecorder 对照调查 + **真正的杀手：invalid_target 会烧掉 RT**（2026-08-06 22:30 CST）

### Q1 nicerecorder 的 token-exchange 带了两个 resource 吗？——**没有，和 nicelist 完全一样**

代码同源（两仓逐字节同构）：
- `lib/auth/oauth/native/nm_token_exchange.dart` → `'resource': resource`，**单值 String**，无法传两次。
- `lib/auth/oauth/native/nm_native_takeover_runner.dart:118` → `resource: NmLogtoConfig.apiResource`（仅业务 resource）。
- 只有 SDK 托管登录链路 (`LogtoConfig(resources: defaultResources)` = `{apiResource, storeResource}`) 才声明两个。

审计佐证（7 天，prod-1）：
| app | TokenExchange | Interaction.Create(托管页) |
|---|---|---|
| nicerecorder `fnegb39eoma7riuamjm8z` | **107 string / 0 array** | 15 array + 592 string |
| nicelist `yfcr5h18kx5ml6lco68ms` | **161 string / 0 array** | 259 array + 612 string |
| nicenote `wgooa3e48a5l830v97x7a` | 18 string / 0 array | 112 string |
三个 App 同缺陷，nicerecorder **没有被修好**。

### Q2 那为什么 nicerecorder「看起来」不掉登录？——**只是爆炸半径小，不是免疫**

store resource 请求方（7 天）：nicelist **24 用户 / 40 IP**；nicerecorder **2 用户 / 2 IP**；nicenote 1 用户。
即 nicerecorder 的 store 同步代码基本没进大规模发布包（M7 提交 `30f186b` 2026-08-01，Release 目录最新包 20260731）。
真正走到 store 的那个 nicerecorder 用户 `ii1r0gcbut29` **今天掉了 6+ 次登录**，行为与 nicelist 一模一样。
次因：nicerecorder 08-05~08-06 连发 v1.3.148→v1.3.155 认证加固（userinfo/账号中心 401 不再误判会话失效、OP 票逐出现刷自愈），
nicelist 停在 08-01 的 v1.0.551，**这些加固一条都没有** → 同一故障下 nicelist 表现更惨。

### Q3 真正的杀手：**invalid_target 抛在 `refreshToken.consume()` 之后**

`packages/core/src/oidc/grants/refresh-token.ts`（prod bundle `main-G3J3TS37.js`）执行顺序：
```
L188  await refreshToken.consume()        ← 先烧掉旧 RT、存新 RT
L217  refreshTokenValue = await refreshToken.save()
L259  resolveResource(...) → InvalidTarget 抛出 → HTTP 400
```
400 响应里**没有**新 RT，客户端仍握着那张**已 consumed** 的旧 RT。下次再用 →
`if (refreshToken.consumed) { destroy(); revoke(ctx, grantId) }` → **整个 grant 被服务端销毁** → 全设备掉登录。

实测同一张 RT 的完整轨迹（nicelist，rt 前缀 `K7SpGfPkcZ`）：
```
21:39:22 RefreshToken resource=store → invalid_target   (RT 在此被 consume)
21:39:38 RevokeToken  (grant_type=refresh_token → 服务端 revoke，非客户端调用)
21:39:38 RefreshToken 同一 RT → "refresh token already used"
21:39:52 RefreshToken 同一 RT → "refresh token not found"（grant 已没了）
```
统计（7 天）：invalid_target 之后**同一张 RT**再出现 "already used" 的比例
= nicelist **65/72**、nicerecorder **24/25**。
RevokeToken 来源拆分（7 天）：nicelist 服务端 replay-revoke **76** vs 客户端主动 revoke 37；
nicerecorder 36 vs 21。**主因是服务端重放销毁，不是客户端的 revoke 反射。**

⇒ 结论修正：即使客户端老老实实**不**调 RevokeToken，只要它重试，登录照样会掉。
「不要 revoke」只能减轻，**唯一根治是客户端别再请求未注册的 resource**。

### 待办（三项，前两项客户端，第三项服务端可选加固）
1. **客户端 P0**：`nm_token_exchange.dart` 的 `resource` 改成可传多值（`List<String>`，form 里重复 key），
   native 接管链路传 `{apiResource, storeResource}`。三仓（nicelist / nicerecorder / nicenote）同源同改。
2. **客户端 P1**：`invalid_target` 不 revoke、不重试同一 RT，直接降级「云同步不可用」。
3. **服务端 P2（加固，非必须）**：把 `resolveResource` 前移到 `refreshToken.consume()` 之前，
   让参数错误不再烧 RT。属自建 override 范围（现仅 override 了 token-exchange），需评估与上游 diff 成本。

## 修正 (2026-08-06 23:10 CST)：ii1r0gcbut29 是**托管页**链路，k12kh936jbqy(native) 未掉登录 —— 结论仍成立但归因要分开

Xianglin 指出：`ii1r0gcbut29` 掉登录走的是 SDK 托管登录链路；native 登录用户是 `k12kh936jbqy`。
逐条核对审计日志，**这一点属实**，且它把两条链路的差异暴露得更清楚。

### 事实核对
`ii1r0gcbut29` 在 nicerecorder 的每一次会话都是 `Interaction.SignIn.* → ExchangeTokenBy.AuthorizationCode`
（托管页 / PKCE），**从无 TokenExchange**。所以之前把它当"走到 store 的 nicerecorder 用户"来
论证 native 链路，是链路张冠李戴 —— 更正。

`k12kh936jbqy`（wechat identity）确为 native：全部 `ExchangeTokenBy.TokenExchange`。
它在 nicerecorder 上 08-06 21:36 与 22:37 两次 refresh 全 Success，**没掉**。

### 但这不代表 native 安全 —— 它只是**没请求 store**
| user | app | 链路 | 有无 store refresh | 结果 |
|---|---|---|---|---|
| k12kh936jbqy | REC (nicerecorder) | native | **无** | 不掉 |
| k12kh936jbqy | REC | native | 08-05 18:32 **有** 1 次 | **立刻 invalid_target → RevokeToken → 掉** |
| k12kh936jbqy | LIST (nicelist) | native | 21:39 / 21:41 **有** | **两轮 invalid_target → 掉** |
| ii1r0gcbut29 | REC | 托管页, resource=**string** (18:47 起) | 有 | **掉，6 轮** |
| ii1r0gcbut29 | REC | 托管页, resource=**array** (16:43–16:45) | 有 | **不掉**，16:45 与 17:50 store refresh 200 |

⇒ 决定结果的**唯一变量是"登录时是否声明了 store resource"**，与 native / 托管页无关。
同一个 native 用户 k12kh936jbqy 在 REC 不请求 store 时正常、一请求 store 就掉；
同一个托管页用户 ii1r0gcbut29 声明 array 时正常、声明 string 时掉。

### 为什么 nicerecorder 托管页当天从 array 退回 string
`Interaction.Create` 参数比对（同一 app、同一用户、同一天）：
- 16:43–16:45：`resource: [apiv3, api.nicematrix.com]`，`device_ref=7fed…`/`b791…` → store refresh 200
- 18:47 起：`resource: "apiv3"` 单值 → 每轮必掉
两段的 `scope` 完全相同（都是 nicerecorder 的旧 7 项 scope，无 `urn:logto:scope:*`），
说明**不是**配置分支差异，而是**装了不同 build**：16:43 那台是带 store 的测试包，
18:47 之后换回线上包。线上包的 `defaultResources` 未生效 / 未包含 storeResource。

补充证据：nicerecorder 全量 RT 存量 **1651 条，resource 100% 是 string，array 0 条**；
nicelist 有 38 条 array（托管页 v1.0.550+ 打出来的）。即 nicerecorder 线上根本没有双 resource 的 grant。

### 结论（覆盖上一节的归因，技术结论不变）
1. `nm_token_exchange.dart` 单值 `resource` 的缺陷**依然存在且必须修** —— native 用户
   k12kh936jbqy 两次触发 store 两次都掉，就是这条路径。
2. 另有**第二处**缺陷：nicerecorder 线上包的**托管页**链路也没声明 storeResource
   （审计 592 string vs 15 array）。nicelist 已修（259 array），nicerecorder 没有。
3. 因此三仓要修的是**两条链路各一处**：
   - 托管页：`generateSignInUri(resources: defaultResources)` 确保线上包含 storeResource（nicerecorder 待确认为何未生效）；
   - native：`nm_token_exchange.dart` 的 `resource` 改多值，takeover runner 传 `{apiResource, storeResource}`。
4. `invalid_target` 烧 RT（`consume()` 先于 `resolveResource()`）的服务端机制与上节记录一致，不受本次修正影响。

## 深挖根因 (2026-08-06 深夜)：两问定论

### Q1 为什么"新增 resource 但不重新登录"的存量用户必掉登录
resource 授权在**登录那一刻**固化进 grant/RT（DB 实证：3575 条 RT 中仅 45 条含 store；
grant 不可追加）。升级到带 store-sync 的新包后：
1. 30s 轮询发 store refresh → 旧 RT 无 store indicator → `invalid_target`；
2. 服务端 `refresh-token.ts` **L188 consume() 先于 L259 resolveResource()** —— 400 响应
   不带旋转后的新 RT，客户端手里的 RT 已是死票；
3. 客户端任何后续 refresh（含业务 resource / OP 票）→ `already used` → oidc-provider
   判定重放攻击 → `revoke(grantId)` 销毁整个 grant；
4. 业务 refresh 随之 `invalid_grant` → `NmSessionInvalidator.invalidateLocalSession()` → 掉登录。
实证节奏（nicelist 用户 zsbzhr6l66vi）：16:25:06 登录 → 16:25:12 invalid_target →
16:25:22 replay-revoke → 16:26:44 重登，**每 ~90s 一轮**，与代码 30s 轮询 + 401 强刷完全吻合。

### Q2 为什么微信 native 登录后"总是"被退出
死循环闭环：native token-exchange 只传 1 个 resource（`nm_token_exchange.dart` 单值 String）
→ 新 grant 依旧没有 store indicator → store 轮询再次 invalid_target → 烧 RT → revoke →
掉登录 → 重登 →（还是单 resource）→ 无限循环。服务端 08-06 12:00 UTC 已支持多 resource，
但客户端不传第二个，服务端修复无法单方面断环。

### 客户端修复清单（定稿）
- **P0-1** 三仓 native 链路：`nm_token_exchange.dart` `resource` 改 `List<String>`（form 重复 key），
  takeover runner 传 `defaultResources`。断 Q2 循环（新登录的 grant 从此含双 indicator）。
- **P0-2** 会话能力门禁（解 Q1 存量、立即止血）：登录成功时持久化
  `session_declared_store_resource=true`；`StoreSyncCoordinator.trigger()` 检查该标志，
  旧会话（无标志）**绝不**发任何 store 请求，等用户自然重登后自动启用。禁止强制登出迁移。
- **P1-1** `AuthFailureClassifier` 新增 `invalidTarget`（400 + body 含 invalid_target）：
  不销毁会话、不重试同 RT、当场写禁用标志关停 store sync。防未来配置漂移。
- **P1-2** 托管页链路核对 `generateSignInUri(resources: defaultResources)` 实际出包生效
  （nicelist v1.0.550+ 已生效 259 array；nicerecorder 线上包未含，需随店内下版带出）。
- 注：修复版发布前已被烧 grant 的用户需重登一次（不可避免，grant 已灭）。

### 服务端配套（P2→建议升 P1）
新增 `refresh-token` grant override：在 `consume()` 之前先校验
`params.resource ∈ refreshToken.resourceIndicators`，不合法直接 InvalidTarget——
让 invalid_target 从「烧会话」降级为「无害 400」，保护一切无法强更的存量客户端。
改动小（提前 ~70 行的一个 guard），风险低，但需新增一个 override 文件并随上游维护 diff。
