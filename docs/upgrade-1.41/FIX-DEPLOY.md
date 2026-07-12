# 1.41 P1/P2 修复部署记录 (avatar.ts getScopedProfile 适配)

修复内容见 `POST-UPGRADE-REVIEW.md` §3;代码提交 `984728a`。

## 镜像

- 构建:2026-07-11,`docker compose --env-file /etc/nicematrix/id.env build logto`(deploy/ 目录,本机)
- 新镜像:`nicematrix-logto:latest` = `6300ce02ea2c`,同 tag `avatar-fix-20260711`
- 回滚 tag:`nicematrix-logto:pre-avatar-fix-20260711` = `b5b1968746ec`(即修复前的 v1.41.0)
- 构建产物核验(镜像内 `core/build/main-*.js` avatarRoutes 段):
  - `const { profile } = await getScopedProfile(...)` ×2 ✓
  - `getAccountCenterFilteredProfile(profile, ctx.accountCenter, updatedUser)` ×2 ✓
  - DELETE status `[200, 400, 401, 500]` ✓(POST 保持 `[200, 400, 401, 422, 500]`)
- 无 DB alteration(纯代码修复,LOGTO_VERSION 仍 1.41.0)。

## Staging (id-staging.nicematrix.com) - ✅ 2026-07-11

- `docker compose up -d --force-recreate logto` → healthy,0 错误日志。
- **真实 user-token 全链路冒烟**(M2M → `POST /api/subject-tokens` (user `ux4219rvs3g7` systemtest) → token-exchange → user access token):
  - `POST /api/my-account/avatar`(multipart 真实 PNG 上传)→ **200**,响应为过滤后 profile,`avatar` = R2 URL,含 `hasSecurityVerificationMethod` ✓
  - `DELETE /api/my-account/avatar` → **200**,`avatar: null` ✓
  - 两个响应体均无 `passwordEncrypted` / `logtoConfig` / `mfaVerifications` ✓(P1 修复前此处 500)
- **回归**:
  - token-exchange `offline_access` → access + id + refresh 三 token PASS(我们的 override 未受影响)
  - `/account` `/account/profile` `/account/security` `/oidc/.well-known/openid-configuration` `/console` 全部 200
  - 容器日志 10 分钟窗口无 error/500

## Prod-1 (id.nicematrix.com) — ⏳ 待 Xianglin 确认后执行

计划步骤（无 DB alteration，纯镜像替换）：
1. prod-1 上 retag 当前镜像为回滚点 `pre-avatar-fix-<TS>`。
2. `docker save | gzip` → scp → **md5 双端核验** → `docker load`（跨境传输防截断）。
3. `docker compose up -d --force-recreate logto` → 确认 healthy。
4. 冒烟（同 staging 套路，真实 user token）：avatar POST/DELETE 200、响应无敏感字段、token-exchange 三 token、5 个页面/端点 200、日志零错误。
5. 回填本段为 ✅ + 实测证据。

回滚：prod-1 本地 `docker tag pre-avatar-fix-<TS> → latest` + force-recreate，无数据影响。
