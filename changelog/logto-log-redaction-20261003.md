# Logto 日志脱敏：请求日志 + 审计日志明文密码（2026-10-03）

## 背景
- 本机号码一键登录审查 CR-04（nicematrix-backend `docs/_reviews/2026-10-02-carrier-one-tap-code-review.md`）：
  `carrier_challenge` 在 180 秒内可认领一条已验证手机号，不能落盘。nginx 侧已加脱敏（三台主机，见 backend
  `docs/runbooks/nginx-access-log-redaction.md`）；Logto 容器自身的 koa-logger 日志同样打印完整查询串。
- 排查时发现：prod-1 Logto `logs` 表 `Interaction.Register.Profile.Update` 载荷以 `{type:"password", value}` 形式保存**明文密码**，
  2026-02 起 406 行，至今仍在新增（上游按键名脱敏，`value` 漏网）。Xianglin 决定：修代码 + 清历史（2026-10-03）。

## 改动
- `docs/patches.md` #14：koa-logger 请求行中查询串含敏感参数（与 nginx 同表，含 `carrier_challenge` / `lc` / `code` …）时整段替换为 `?<redacted>`。
- `docs/patches.md` #15：审计日志脱敏入口对 `type=password` 的 `value` 屏蔽为 `******`。
- 单测：`request-log-redaction.test.ts`、`sensitive-data.password-value.test.ts`；回归：上游 `sensitive-data.test.ts`、`koa-audit-log.test.ts`
  与批 B 相关套件，共 8 套件 43 例全过；`build:test`（tsc）无错误。

## 历史数据
- 已有行用同一规则清理（只把 `payload.payload.value` 置为 `******`，其它字段不动）；**不保留含明文的备份**（回滚无正当用途），只记录行数。
- 2026-09-14（v1.43.0）以前的行另有 Argon2 摘要、M2M `client_secret`、TOTP 秘钥等（上游当时未脱敏），未在本次范围内，见汇报。

## 部署
- 镜像 `nicematrix-logto:release-3bf170e92c5fd1aea01d5ab224e7bfa880b0ddfd-20261003-202038`（含批 B `89dc59e` 全部内容）。
  生产独有补丁标记计数与旧镜像一致（requestedResources 7 / hookMatchesRegion 2 / by-identity 2 / verification-records 4 /
  mfaIssuerName 5 / assertFirstPartyClient 34 / connectors 50）。
- staging（rollback `rollback-staging-20261004-023121`）：请求日志 `carrier_challenge` / `code` → `?<redacted>`、普通查询串原样；
  真实注册交互提交密码 → 审计行 `value: ******`、全表 0 明文；历史 6 行已清理。
- prod-1（2026-10-03 20:36 MDT，rollback `rollback-prod-1-20261004-023553`）：md5 / RootFS.Layers 两端一致；healthy，discovery / JWKS 200、
  status 204，0 错误。生产真实请求验证 `value: ******`、0 明文、未建用户；历史 406 行在事务内清理并校验剩余 0。
  不带 carrier 参数的登录页换镜像前后 6 组截图逐像素相同。
