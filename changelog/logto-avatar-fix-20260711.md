# Logto 1.41.0 P1/P2 avatar 修复 (2026-07-11)

## 背景
POST-UPGRADE-REVIEW (`nicematrix-id/docs/upgrade-1.41/POST-UPGRADE-REVIEW.md`) 发现:
- **P1**: 我们自有的 `account/avatar.ts` 未适配 1.41 `getScopedProfile` 新返回结构
  `{ profile, user }`,把包装对象整个传给 `getAccountCenterFilteredProfile` →
  zod response guard 500(头像实际已写库但接口报错;`passwordEncrypted` 装入响应对象
  但被 guard 挡住未出网)。线上零流量未触发。
- **P2**: DELETE 路由 status 白名单缺 500。

## 修复 (commit 984728a, nicematrix-id main)
- `avatar.ts` L112/L138: `const { profile } = await getScopedProfile(...)`;
  第三参传 `updatedUser`(响应带 `hasSecurityVerificationMethod`,与 upstream PATCH 一致)。
- DELETE status → `[200, 400, 401, 500]`。
- `docs/patches.md` 升级 checklist 新增 **OUR-NEW 接缝检查** + 真实 token 冒烟要求
  (方法论教训:drift 工具看不到"自有文件调用了 upstream 改签名的函数")。

## 镜像与部署
- 新镜像 `nicematrix-logto:latest` = `6300ce02ea2c`(tag `avatar-fix-20260711`);
  回滚 tag `pre-avatar-fix-20260711` = `b5b1968746ec`。无 DB alteration。
- 构建产物已在镜像内 `core/build/main-*.js` 核验(解构 ×2、第三参 ×2、status 500)。
- **staging 已部署+冒烟全绿**(真实 user token: M2M → subject-token → token-exchange):
  avatar POST/DELETE 200、响应无敏感字段、token-exchange offline_access 三 token PASS、
  /account 三页 + OIDC discovery + console 200、日志零错误。
- **prod-1 已部署 (2026-07-11 19:56 MDT, Xianglin GO)**: md5 双端核验 `8d910bfa…`,
  prod-1 image `c7f669934021`, 回滚 tag `pre-avatar-fix-20260711_1942`=`30e9c4396809`;
  同套真实 token 冒烟全绿 (avatar POST/DELETE 200 + 三 token + 5 端点 200 + 日志零错误)。
  完整部署证据: `nicematrix-id/docs/upgrade-1.41/FIX-DEPLOY.md`。
