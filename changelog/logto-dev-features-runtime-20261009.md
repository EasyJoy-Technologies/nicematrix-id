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
- staging：待填
- prod-1：待填
