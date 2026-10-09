# Logto：开发功能开关前后端统一（2026-10-09）

触发：Xianglin 反馈后台 Logto 控制台进入用户详情页，顶部总是报 “Not Found”。
决定：Xianglin 2026-10-09 15:15 MDT —— 需要用到开发状态功能，开关保持打开，服务端一并打开。

## 根因
- `logto-custom/Dockerfile` 只在 **builder** stage 设 `DEV_FEATURES_ENABLED=true`；app stage 从干净的 `node:22-alpine`
  起，不继承 → 运行镜像与容器均无该变量（prod-1 全部 13 个历史 `nicematrix-logto` 镜像 + staging 已核），core 一直是关。
- 结果：console / account / experience 三个前端包编译期为开，core 运行期为关。v1.43 起控制台用户详情页渲染
  “受信任设备”卡片 → `GET /api/users/:id/trusted-devices`，core 未注册该路由 → koa 默认 404（body 9 字节 `Not Found`）。
  prod-1 nginx：近两周控制台唯一持续 404。
- 同源的静默不一致：MFA 页受信任设备开关、组织“允许受信任设备”、账户中心 trustedDevice 字段保存被 core 丢弃；
  Webhook `TrustedDevice.*` 事件保存被拒；自定义 JWT “错误处理”（`blockIssuanceOnError`）core 不读取。

## 改动
- Dockerfile：全局 `ARG dev_features_enabled=true`；builder 与 app 均 `ENV DEV_FEATURES_ENABLED=${dev_features_enabled}`。
- `scripts/check.sh`：断言两侧同值、compose 不另设运行时变量。
- 文档：`docs/account-center-profile.md`（去掉已过时的“不开会裁掉账户中心”说法）、`docs/patches.md` #17、
  `OssOnboardingGuard` 注释。

## 行为变化（core 运行期新开启的 dev 分支，上线前 prod-1 数据已逐项核对）
| 功能 | 触发条件 | prod-1 现状 | 用户影响 |
|---|---|---|---|
| 受信任设备（登录跳过 MFA / 选择“信任此设备”） | 登录体验 `trusted_device.enabled=true` | 两租户均 `{}` → 默认 `false`；`trusted_devices` 0 行 | 无 |
| 账户中心受信任设备 | `account_centers.fields.trustedDevice` 可见 | 两租户均未设 | 无 |
| 管理 API `/api/users/:id/trusted-devices` | 管理员调用 | — | 修复控制台 404 |
| IdP 发起的 SAML SSO | SSO 连接器 + IdP-initiated 配置 | SSO 连接器 0、配置 0 | 无 |
| JWT 定制出错阻断签发 | JWT customizer 且 `blockIssuanceOnError` | 未配置 JWT customizer | 无 |
| 重置密码一次性令牌首屏 | 请求带 `first_screen=reset_password&one_time_token` | 无客户端使用 | 无 |
| 调试注入请求头 | `DEBUG_INJECTED_HEADERS_JSON` 环境变量 | 未设置 | 无 |
| Webhook `TrustedDevice.*` 事件、Swagger dev 文档 | 管理端 | — | 无 |

注意：今后在控制台打开以上任一项即在生产生效（例如 MFA 页开启受信任设备 = 用户可在信任设备上跳过 MFA），属于需评审的配置变更。
升级 Logto 时，新的上游 dev 功能会同时在前后端出现，升级评审需列出新增 `isDevFeaturesEnabled` 分支。

## 部署
- staging `id-staging`（2026-10-09）：镜像 `nicematrix-logto:release-d1b16f02ad53087aa62c335c045bb38e8ab18fce-20261009-151828`（rollback `nicematrix-logto:rollback-staging-20261009-212927`）。
  - 构建：镜像 `Config.Env` 含 `DEV_FEATURES_ENABLED=true`；lineage 计数 7/2/2/4/5/34、connectors 50，与 staging 旧 `:latest`、prod-1 在线镜像一致；
    prod-1 在线 release 提交 `2bfdcd8` 为 HEAD 祖先，与之相比代码差异仅 Dockerfile + 一处注释。
  - 修复前基线（M2M）：`GET /api/users/:id/trusted-devices` → 404 `Not Found`；`sign-in-exp` 无 `trustedDevice`。
  - 修复后：3 个 node 进程 `DEV_FEATURES_ENABLED=true`；同一请求 → 200 `[]`；不存在的用户 → 404 JSON `entity.not_found`（路由已注册）；
    `sign-in-exp.trustedDevice` = `{}`（未启用）。discovery 200、`/api/status` 204、JWKS 200、`server_error` 0。
  - 回归 smoke（`docs/upgrade-1.43/smoke/`）：hosted-login 13/13、mfa-explicit-optin 35/35、mfa-neutral 10/10、ui-and-callback 21/21、
    token-exchange 11/11（`APP_ID=luckh1qjgg76zidyaipk6`；默认 `乐趣记事本` 在 staging 的 redirectUris 为空 → `invalid_redirect_uri`，
    属既有 staging 数据状态，与本次无关）。
- prod-1（2026-10-09 15:36 MDT，Xianglin 15:34 确认；= intl + cn 两区）：
  - 前置：R2 回执 04:14Z（4 个 base）；`deploy.sh` preflight OK。
  - 传输：`docker save` 335 MB，两端 md5 `e905f325…` 一致；`RootFS.Layers` 两端 md5 `03a8ff6a…` 一致；镜像 `DEV_FEATURES_ENABLED=true`；
    lineage 7/2/2/4/5/34、connectors 50 与在线镜像一致。
  - 切换：`deploy.sh --target prod-1 --candidate <上面 release tag> --apply` exit 0，rollback `nicematrix-logto:rollback-prod-1-20261009-213634`。
  - 验证：healthy、RestartCount 0；3 个 node 进程 `DEV_FEATURES_ENABLED=true`；M2M `GET /api/users/:id/trusted-devices` 200 `[]`
    （修复前 nginx 记录为 404 `Not Found`），不存在用户 → 404 `entity.not_found`；`sign-in-exp.trustedDevice` = `{}`；discovery 200、
    `/api/status` 204、JWKS 200、`/console/` 200；切换后 `server_error` 0、无 uncaught，nginx 切换后无 5xx。
