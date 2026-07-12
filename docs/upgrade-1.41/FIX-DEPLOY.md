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

## Prod-1 (id.nicematrix.com) — ✅ 2026-07-11 19:42–19:56 MDT (Xianglin GO)

- 回滚 tag（prod-1 本地，部署前先打）：`nicematrix-logto:pre-avatar-fix-20260711_1942` = `30e9c4396809`（即修复前的 v1.41.0）
- 传输：`docker save avatar-fix-20260711 | gzip`（328MB，gzip -t 完整性验证）→ scp → **md5 双端一致** `8d910bfa600684411a99b862c1ebda63` → `docker load`（prod-1 上 image id `c7f669934021`，与本机构建同源）→ retag `latest`
- 镜像内产物二次核验（prod-1 上一次性容器）：解构 ×2、第三参 `updatedUser` ×2、DELETE status `[200,400,401,500]` ✓
- `docker compose --env-file /etc/nicematrix/id.env up -d --force-recreate --no-build logto` → healthy
- **冒烟（在 prod-1 主机上执行，secrets 不离机；M2M `m-admin` → subject-token (user `ux4219rvs3g7` systemtest) → token-exchange client `71xn57jfgatye1oequ3ca`）：**
  - `POST /api/my-account/avatar`（真实 PNG multipart）→ **200**，avatar = R2 URL，含 `hasSecurityVerificationMethod: true`，无敏感字段 ✓
  - `DELETE /api/my-account/avatar` → **200**，avatar 清空，无敏感字段 ✓
  - token-exchange `offline_access` → access + id + refresh 三 token **PASS**
  - `/account` `/account/profile` `/account/security` `/oidc/.well-known/openid-configuration` `/console` 全 200
  - 容器日志 15 分钟窗口无 error / ResponseBodyError / 500
- 传输文件双端已清理。

回滚（如需）：prod-1 `docker tag nicematrix-logto:pre-avatar-fix-20260711_1942 nicematrix-logto:latest` + force-recreate，无数据影响。
