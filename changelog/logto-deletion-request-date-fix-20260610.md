# Logto deletion-request GET 500 修复 — 2026-06-10

## 症状
前端 Account Center 删除账号后报错；`GET /api/my-account/deletion-request` 返回 500，导致 DeletionSection 渲染失败。prod-1 当时有 1 条真实 open 记录（`hmzqovmpp7utp4vbbxowq`, status=pending），该用户注销页实际在线 500。

## 根因（运行期实测，非推测）
文件：`nicematrix-id/logto-custom/overrides/packages/core/src/routes/account/deletion-request.ts`

slonik pool（`packages/core/src/env-set/create-pool.ts` 用 `@silverhand/slonik` 默认 `createInterceptorsPreset()`）对查询结果做**两个**变换，原代码两个都没处理对：
1. **timestamptz → 毫秒 epoch number**（不是 JS Date）。原 `responseGuard` 用 `z.date()`，数字喂进去 safeParse 失败 → koa-guard 抛 `ResponseBodyError` → 500。
2. **字段名 snake_case → camelCase**（`requested_at`→`requestedAt`、`confirmation_token_expires_at`→`confirmationTokenExpiresAt`）。原代码 `row.requested_at` 取到的是 `undefined`。

> 用户最初只指出了 #1。#2 是在部署前用「容器内真实 slonik + staging DB 真实行」的探针脚本跑出来才发现的——第一版只改 #1 的提交（`9fcb23f`）仍会 500（`new Date(undefined)` → RangeError）。教训：长构建前必须用真实依赖跑探针验证，别只靠静态推理。

附带隐性 bug：confirm handler 的过期判断 `row.confirmation_token_expires_at`（snake_case）恒为 undefined → falsy → **token 过期从未被强制执行**。修复后读 `row.confirmationTokenExpiresAt` 才真正生效。

## 修复
- `DeletionRequestRow` 字段类型：`Date`→`number`，且键名改 camelCase（匹配 slonik 返回）。
- 新增 `toIso()`（null/undefined 安全），`rowToResponse` 把 epoch number 转 ISO 字符串。
- `responseGuard` 及 POST create/confirm 响应 guard：`z.date()`→`z.string()`（ISO-8601），与前端 `apis/deletion.ts` 既有 `string` 契约对齐。
- POST create/confirm 的 `ctx.body` 显式 `.toISOString()`（wire 输出不变，去掉误导性 z.date guard）。
- confirm handler 过期判断改读 `row.confirmationTokenExpiresAt`（null+undefined 双判），比较改 `< Date.now()`。

影响面排查：custom overrides 内 `z.date()` 仅此一文件；GET 受影响，POST create/confirm 原本输出 ISO 字符串侥幸不崩但 guard 误导；DELETE 无 response guard。nicematrix-backend 经直连 SQL 读该表（`user-deletion/*.js`），不走此 HTTP API，无跨仓影响。

## 提交（dev repo `nicematrix-id`, main）
- `9fcb23f` fix #1（timestamptz→number）— 不完整
- `243fced` fix #2（snake_case→camelCase）— 完整修复
两次均用 deploy key push。本地无 node_modules，用 `esbuild --loader=ts` + `node --check` 做语法/类型剥离校验；真正 tsc 在 Docker `pnpm -r build`（两次构建 0 error TS）。

## 部署（按 deployment-standard.md §3/§4）
- 本机 = **staging**（`id-staging.nicematrix.com` → 本地 `nicematrix-logto:3001`）；prod = **prod-1** `46.224.6.74`（`id.nicematrix.com`，全站身份服务）。
- 镜像两版：第一版 build = `7f745b4ed6c6`（含不完整 fix，仅 staging 短暂运行，未上 prod）；**第二版 build = `33a7c7ea4eeb`（config `586b95e392cd`）= 最终交付镜像**。
- Staging：rebuild（0 TS error）→ 重建容器 healthy → OIDC 200 / 接口 401 非 500 / 编译产物含 camelCase / runtime guard 探针（open-row + no-row 均通过）。
- Prod-1：`docker save` 33a7c7ea4eeb → scp（md5 两端一致 `50deb571...`）→ tag 当前 prod `c5d5b71b428a` 为 `prod-backup-20260610` → load → 重建容器（10s healthy）→ OIDC 200 / 接口 401 非 500 / **真实 open 记录 `hmzqovmpp7utp4vbbxowq` GET 逻辑实测通过** / 错误日志 3min 干净 → 清理 tar。无 DB migration（表已存在）。
- 回滚（30s）：`docker tag nicematrix-logto:prod-backup-20260610 nicematrix-logto:latest && cd /var/www/nicematrix-id && docker compose --env-file /etc/nicematrix/id.env -f deploy/docker-compose.yml up -d logto`。

## 镜像 tag 现状
- staging: `latest`=`deletion-date-fix-20260610`=`33a7c7ea4eeb`；回滚 `staging-backup-20260610-0302`=`eda672bc69ca`。
- prod-1: `latest`=`deletion-date-fix-20260610`=`586b95e392cd`(=33a7c7ea4eeb)；回滚 `prod-backup-20260610`=`c5d5b71b428a`。
