# Logto: 本机号码一键登录审查修复 批 B（2026-10-03）

审查与方案：nicematrix-backend `docs/_reviews/2026-10-02-carrier-one-tap-code-review.md` §6 批 B（B1–B5、B7）。
决定：Xianglin 2026-10-03 00:26 / 00:31 MDT（分批修复；CR-02 客户端 + 服务端两层；CR-14 提示补填但允许跳过）。
配套 Backend：API v1.2.708（A6 已读取 launch context 的 `app_version`；B2 必须在其之后上线）。

## 改动（overrides 层 + NiceMatrix 自有文件；不改上游源码 / 表结构 / lockfile / 文案文件）
| # | 文件 | 改动 | 对应 |
|---|---|---|---|
| B1 | `core/…/experience/classes/verifications/social-verification.ts`（**新** override） | carrier 新用户的号码已被其他账户占用 → 422 `user.phone_already_in_use`，不再静默丢号（其它连接器不变） | CR-03 / CR-18 |
| B1 | `experience/src/hooks/use-social-register.ts`（**新** override）、`pages/SocialSignInWebCallback/use-social-sign-in-listener.ts` | carrier 注册遇 422 → “已超时，请重试”提示回登录页；下一次号码登录关联到已占用该号码的账户 | CR-03 |
| B2 | `schemas/src/consts/oidc.ts`、`core/src/libraries/carrier-launch-context.ts` | ExtraParam `app_version`，签进 launch context（不合法 = 不签） | CR-07 |
| B3 | `core/src/middleware/koa-carrier-login-prompt.ts`（ours）、`core/src/oidc/init.ts`（挂载） | `/oidc/auth` 带合法 carrier 参数时 `prompt` 追加 `login` | CR-02 |
| B4 | `core/src/libraries/carrier-launch-context.ts`、`experience/…/SocialSignInList/use-social.ts` | 缺 key / App 上下文 / 合法 carrier 参数 → `connector.not_enabled`；Experience 静默回普通登录页并禁用本次号码登录 | CR-17 |
| B7 | Core：`routes/experience/types.ts`、`classes/profile.ts`、`routes/experience/index.ts`（**新** override）+ `carrier-profile-skip-routes.ts`（ours，含 openapi） | `GET/POST /api/experience/profile/carrier-skip`；仅 carrier 新注册 + 交互内跳过标记时放行缺失的次要标识 / 密码 / 必填资料字段 | CR-14 |
| B7 | Experience：`apis/carrier-profile-skip.ts`、`hooks/use-carrier-profile-skip.ts`、`utils/carrier-profile-skip-context.ts`（ours）；`pages/Continue/index.tsx`、`Layout/SecondaryPageLayout/index.tsx`（**新** override） | 补资料页显示上游 NavBar 自带“跳过”（`action.nav_skip`，四语已有）；服务端确认可跳过才显示 | CR-14 |

## 验证
- 单测（Logto 工作区 v1.43.0 + 全部 overrides）：新增 / 扩充 `koa-carrier-login-prompt.test.ts`、`carrier-launch-context.test.ts`、
  `social-verification.carrier.test.ts`、`profile.carrier.test.ts`（Core 32 例），`pages/Continue/carrier-skip.test.tsx`（Experience；
  相关 16 套件 73 例全过）。Core / Experience `tsc` 无新增错误。Core jest 已跑 306/307 套件，11 个失败套件与本批无关（MFA 既有覆盖、
  管理 API 资源域名覆盖、日期、WebAuthn 依赖、连接池、负载超时；单独运行确认）。`logto-custom/tests/run.sh` 全过。
- staging 部署与真浏览器 e2e：见下方“部署”。

## 部署
- staging `id-staging`（2026-10-03）：镜像 `nicematrix-logto:release-89dc59e7f39db66329e43cd1aa77e67cb88b64b5-20261003-181531`
  （rollback `nicematrix-logto:rollback-staging-20261003-182527`；中间版 `release-8eceff5…-20261003-175527`）。部署后 Logto 日志 0 条错误。
- staging 真浏览器 e2e 33/33：B3 已有 X 会话 + 号码 Y（仅 `prompt=consent`）→ 进入 Y、拿到 refresh token、`phone_number_verified=true`
  （旧镜像上同一用例进入 X）；无 carrier 参数仍沿用会话；`prompt=none`+carrier → `invalid_request`；B4 缺 region → 普通登录页、无额外提示；
  B2 h5 最低版本 2.1.0：`app_version=2.0.0` 回登录页、`2.1.0` 进入 Broker h5 页；B7 en / zh-CN / zh-TW 补资料页显示“Skip / 跳过 / 跳過”，
  跳过后注册完成（仅手机号 `86…`，无用户名 / 邮箱 / 密码）；填用户名后下一页仍可跳过；用户名注册无跳过、直接调用跳过接口 400；
  停在补资料页期间号码被占用 → 不产生无号账户，提示超时重试并回登录页。测试数据全部清理。
- prod-1：待确认（B6）。
- 补充（`89dc59e`）：补资料跳过时号码被他人占用 → 与回调一致（staging e2e 发现，原先停在原页只显示上游提示）。
