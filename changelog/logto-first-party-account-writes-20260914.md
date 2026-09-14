# 我方 Account 写路由补 `assertFirstPartyClient`（2026-09-14）

**来源:** Logto 1.41→1.43 升级复盘遗留项 #2（`docs/upgrade-1.43/POST-UPGRADE-REVIEW.md` §4）
**commit:** `e561971`
**镜像:** `nicematrix-logto:release-e56197125ec3f00d4760d11a4dc6448a050ff6cc-20260914-140410`
**上线:** id-staging + prod-1（= intl + cn 两区）均已切换，Logto 版本仍为 `1.43.0`

---

## 背景

1.43 给**所有上游 Account API 写操作**加了 `assertFirstPartyClient`
（`packages/core/src/utils/assert-first-party-client.ts`）：access token 属于第三方应用则 403。
理由是第三方应用天然带 `openid`，而路由的权限判断复用 OIDC claim scope——管理员给第三方开
`profile` 只表示"可读"，用户同意书上也只写了读取，不等于授权它**改**账号数据。

我方两个自写 override 是当时唯一没有这道断言的 Account 写入口。

## 改动

| 文件 | 加断言的端点 |
|---|---|
| `routes/account/avatar.ts` | `POST` / `DELETE /api/my-account/avatar` |
| `routes/account/deletion-request.ts` | `POST` / `POST …/confirm` / `DELETE /api/my-account/deletion-request` |

- 断言位置与上游一致：scope / 字段控制校验之后、任何写入之前；`deletion-request` 的
  `POST` 里它排在 `identityVerified` 之前（与上游 `account/index.ts` 同序），所以第三方
  拿到的是 403 而不是 401。
- 每个被改路由的 `koaGuard` `status` 数组补 403（上游同样这么做）。
- **`GET /api/my-account/deletion-request` 不加**：读自己的待销号记录，上游也只守写操作与
  verification record 签发。
- 断言 fail-closed：解析不出应用的 client（含 CIMD client identifier URL）一律拒绝。

## 验证

### id-staging —— `docs/upgrade-1.43/smoke/smoke-first-party-account-writes.sh`，17/17 全绿

方法上刻意做成**单变量对照**：临时建一个 SPA 应用 + 一个用户，走真实托管登录
（密码 → TOTP → passkey 跳过 → 备份码 → consent → code → token）拿到**一条真实的最终用户
access token**；先跑一遍全部写端点作基线，再把**同一个应用**的 `is_third_party` 翻成 true、
重启容器、用**同一条 token** 重放。两趟之间只有这个标志位不同。

| 端点 | 第一方（基线） | 第三方（翻转后） |
|---|---|---|
| `GET /deletion-request` | 200 | **200**（读路径未受影响） |
| `DELETE /deletion-request` | 204 | **403** |
| `POST /deletion-request` | 401（自身的 identity-verified 闸口） | **403** |
| `POST /deletion-request/confirm` | 404（自身的 token 校验） | **403** |
| `DELETE /avatar` | 200 | **403** |
| `POST /avatar` | 200 | **403** |

跑完自动把标志位翻回 false 并删除临时应用与用户；复核 staging 无残留（21 个应用、
0 个第三方）。

### 镜像与血缘

- `packages/core build: Done`，全程 `error TS` = 0。
- bundle 内实测：avatar 2 处调用、deletion-request 3 处调用，`status` 数组含 403。
- 与上一个生产镜像逐项比对：`requestedResources` 7 / `hookMatchesRegion` 2 / `by-identity` 2 /
  `verification-records` 4 / `mfaIssuerName` 5 / connector 49 —— 全部一致；唯一差异是
  `assertFirstPartyClient` 出现次数 **26 → 31**（正好 5 处新增调用）。
- save/load 后 `RootFS.Layers` 两端 md5 一致（`2fa4354f…`），tar md5 一致（`d0c52244…`）。

### prod-1

- 切换后容器 healthy，`/oidc/.well-known/openid-configuration` 200、`/api/status` 204、
  `/oidc/jwks` 200、`/console/` 200，真实 SPA 的 `/oidc/auth` 303 进 sign-in。
- `server_error` = 0，无未捕获异常，`RestartCount` = 0。
- **生产语义零变化**：22 个 application 全部 `is_third_party=false`，断言不可能命中；
  这是一道防御，等第一个第三方应用出现时自动生效。
- 回滚锚点：`nicematrix-logto:rollback-prod-1-20260914-202731`；
  staging 回滚锚点 `nicematrix-logto:rollback-staging-20260914-201740`。

## 后续

- 阶段二（两步验证显式开启，`docs/mfa-explicit-optin-plan.md`）**不再需要**捎带此项，§8.1 已标完成。
- 下次 prod 部署做血缘核对时，`assertFirstPartyClient` 的基线次数是 **31**，不是 26。
