# 账户注销：执行态不可取消 + 网页注销验证死路由修复（2026-09-29）

依据：NiceNote `nicenote/docs/auth/account-center-code-review-2026-09-27.md` §10（N11 / N12）。
批准：Xianglin 2026-09-29（同意修改本仓；**部署由 nicematrix-system agent 安排**）。

## 变更

1. **Migration `sql/20260929_user_deletion_executing.sql`**（+ `.down.sql`）
   - 新列 `attempt_count`（默认 0）、`next_attempt_at`、`lease_owner`、`lease_until`；
   - 状态约束加入 `executing`；「每用户一条开放请求」唯一索引改为
     `user_deletion_requests__open_per_user_v2`（含 `executing`）；新增 `__executing` 索引；
   - 维护角色 `nicematrix_backend_maintenance` 获新列的 SELECT/UPDATE 列授权（角色不存在则跳过）。
   - 幂等（重复执行无副作用）；新列可空/有默认，旧 Backend 在新 schema 上照常工作。
2. **Logto 路由 `routes/account/deletion-request.ts`**
   - GET / POST 视 `executing` 为开放请求（GET 返回该状态；POST 返回 409 already_exists）；
   - DELETE：取消 0 行且存在 `executing` 行 → **409 `user.deletion_request_executing`**。
     取消 UPDATE 与 Backend 的 `pending → executing` 认领在行锁上串行化，恰有一方成功。
3. **Account Center 网页**
   - 新页 `pages/DeletionVerify`（`/deletion/verify`）：复用上游 `VerificationMethodList`
     验证身份后回首页并重新打开注销弹窗。原 `navigate('/verify')` 路由不存在、静默回首页，
     未持有验证记录的用户永远打不开注销弹窗；无任何验证方式的用户现在看到上游明确的
     「无可用验证方式」页，而不是静默跳回。
   - DeletionSection：`executing` 横幅（无取消按钮）；取消遇 409 提示「已进入执行阶段」；
     提交时验证记录过期 → 清记录并提示重新验证；409 already_exists 后刷新状态。
   - `deletion-phrases.ts`：`executing_banner_title / executing_banner_description / error_executing`
     （zh-CN / zh-HK / zh-TW / en）。

## 验证

- 一次性 PostgreSQL 16：`20260420 → 20260824 → 20260929` 连续执行两次（幂等）→ down（`executing`
  行转 `failed`）→ 再 up；最小权限角色跑 Backend 认领测试 9/9 通过。
- 类型检查（依赖包 build 后 `tsc --noEmit`）：改动文件无新增错误；仅有既有的两类
  （ProfileSection 自定义 phrase 键、deletion-request 自定义错误码不在 `LogtoErrorCode`
  联合内——tsup 构建不做类型检查，与既有 3 处同形）。

## 部署顺序（交 nicematrix-system）

1. 本 migration（staging → prod-1）；
2. Backend API v1.2.697（认领 + 重试）；
3. 本 Logto 镜像（409 + `/deletion/verify`）。
回滚：先回 Logto 镜像与 Backend，再按需执行 `.down.sql`。
