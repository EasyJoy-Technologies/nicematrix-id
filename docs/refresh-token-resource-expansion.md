# Refresh-Token Grant：resource 校验前移 + 受控扩集（方案 A）

> 目标：为自有云同步（store）上线做准备。存量已登录用户在**不重新登录、零感知**的前提下，
> 会话自动升级为「业务 + store」双 resource。同时根治「`invalid_target` 烧毁 refresh token →
> 全 grant 被 revoke → 全设备掉登录」的事故类别（2026-08-06 事故，根因分析见
> nicematrix-system workspace `memory/changelog/logto-token-exchange-multi-resource-20260806.md`）。
>
> 配套客户端文档：nicematrix-backend `docs/integration/client-multi-resource-fix.md`。
> **部署顺序硬约束：本文档两项服务端改动必须先于客户端新包上线。**

## 1. 改动清单（两项，一个 override 文件）

新增 override：`logto-custom/overrides/packages/core/src/oidc/grants/refresh-token.ts`
（fork 自 `logto-upstream/packages/core/src/oidc/grants/refresh-token.ts`，该文件本身是
Logto 对 oidc-provider `refresh_token` grant 的自定义实现，upstream commit
`cf2069cbb31a6a855876e95157372d25dde2511c`；与已上线的 token-exchange override 同一模式）。

### S1：resource 校验前移到 `consume()` 之前（消灭「烧会话」）

现状（上游顺序）：`refreshToken.consume()`（L188，旧 RT 立即作废）→ 新 RT save →
`resolveResource()`（L259）才抛 `InvalidTarget` → 400 响应**不含新 RT** → 客户端持死票
重试 → `already used` → OP 按重放攻击 `revoke(grantId)` 销毁整个 grant。

改动：在 `refreshToken.consumed` 检查之后、`consume()` 之前插入前置校验——

- `params.resource` 归一化为数组（RFC 8707 允许重复 key；oidc-provider 对
  refresh_token grant 已声明 resource 可重复）。
- 每个请求的 resource 必须满足其一：(a) ∈ 该 RT 已有 indicator 集合
  （`refreshToken.resourceIndicators`）；(b) 满足 S2 扩集资格。
- 否则**立即**抛 `InvalidTarget`——此时旧 RT 未被 consume，客户端拿 400 后原 RT 依然
  可用，事故降级为「无害 400」。这同时兜底保护一切无法强更的存量客户端。

### S2：受控扩集（方案 A 本体）

前置校验中命中「(b) 扩集资格」的 resource，在 RT 旋转时并入新 RT：

- 资格 = 同时满足：
  1. 客户端为 **first-party**（`applications.is_third_party = false`；实现时确认能否从
     `client` metadata 直接读取，否则经 queries 查库并缓存）；
  2. resource ∈ **白名单**（仅两个，均为 0 scope 的本司 API）：
     `https://api.nicematrix.com`（store，也是 intl 业务）、`https://apiv3.ej-mobile.cn`（cn 业务）。
- 旋转时新 RT 的 `resource` = `union(旧 indicator 集合, 本次请求集合)`（数组形式）。
  存量用户下一次正常后台 refresh（本来就每小时发生）即自动升级为双 resource 会话。
- 本次请求的 AT 仍按请求的单个 resource 签发（多值时走 primary，与 token-exchange
  override 同样的 primary 语义）。
- 每次扩集打审计日志一行（clientId、accountId、扩入的 resource），可观测放量进度。

### 实现检查点（写码时逐项确认）

- [ ] `rotateRefreshToken` 在我们的 Logto 配置下为 true/函数真值（扩集依赖旋转才落库）。
      若存在不旋转路径，扩集需在该路径显式落库或明确记录不支持。
- [ ] `grant` 对象未含新 resource 时，`grant.getResourceScopeFiltered(resource, …)` 返回
      空 scope——两个 resource 都是 0 scope，空 scope 是**正确**结果；验证 backend
      （`/v1/store/*` 与业务 API）对「aud 正确 + scope 为空」的 AT 放行。若 backend 要求
      非空 scope，则扩集时需同步 `grant.addResourceScope` + `grant.save()`（避免则不做）。
- [ ] 归一化与 primary 选取逻辑与 token-exchange override 复用/对齐（勿复制两份漂移；
      注意该 override 曾踩过 ctx Proxy 的 JS invariant 坑，见 commit `b272a05`）。
- [ ] 不改变无 `params.resource` 的请求路径（organization token 分支、OIDC-only 分支
      行为逐字节不变）。
- [ ] 白名单硬编码在 override 内常量（与 token-exchange override 一致），不引入新 env。

## 2. 部署（High risk：Logto 重启中断登录 10–30s，需明确确认后执行）

1. 构建：本机 `systemd-run --unit=…` 跑 docker build（~40 min；裸 nohup 会被回收）。
2. 传输：`docker save` → `rsync --partial --inplace` → 两端 `md5sum` 一致 → `docker load`。
3. prod-1 上先锚定回滚：`docker tag nicematrix-logto:latest nicematrix-logto:pre-rt-expansion-<date>`。
4. 确认新镜像包含全部 prod-only 修复（含 2026-08-06 token-exchange 三连 commit
   `6cbb898`/`b272a05`/`6c523d3` 均为 HEAD 祖先）。
5. `cd /var/www/nicematrix-id/deploy && docker compose --env-file /etc/nicematrix/id.env -p nicematrix-id up -d logto`。
6. 回滚 = retag 锚点回 `:latest` + `compose up -d logto`。

## 3. 验证清单（staging 全过 → prod；prod 部署后逐项执行）

1. **扩集正过**：取一个只含单 resource 的存量 RT（staging 可用旧包登录制造），
   `grant_type=refresh_token&resource=https://api.nicematrix.com` → 200；查
   `oidc_model_instances` 新 RT `resource` 为**数组**且含两值；用新 RT 再 refresh 业务与
   store 各一次，均 200。
2. **无害 400（关键回归）**：同一张 RT 请求白名单外 resource（如
   `https://evil.example.com`）→ 400 `invalid_target`，**且原 RT 紧接着正常 refresh 仍
   200**（未被 consume、grant 未被 revoke）。
3. **第三方不扩集**：用（或造）一个 third-party client 的 RT 请求白名单内新 resource →
   400 `invalid_target`，RT 仍可用。
4. **token-exchange 回归**：既有 6/6 用例全过（多 resource native 登录不回归）。
5. **prod 观察 24h**：Logto 审计 `invalid_target` 趋零；`RevokeToken` 中服务端
   replay-revoke 计数显著下降；`server_error` = 0。

## 4. 状态

| 项 | 状态 |
|---|---|
| token-exchange 多 resource（前置依赖） | ✅ 已上生产 2026-08-06 |
| S1 校验前移 | ⬜ 今日实施 |
| S2 受控扩集 | ⬜ 今日实施（与 S1 同一 override、同一次部署） |
| 客户端配套 | ⬜ 见 backend `docs/integration/client-multi-resource-fix.md`（依赖本部署先行） |
