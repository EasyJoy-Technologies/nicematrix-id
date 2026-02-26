# 手机端接入文档（OIDC）

> 目标读者：iOS / Android 客户端研发

## 基本信息

- Issuer: `https://id.nicematrix.com/oidc`
- Authorization endpoint: `https://id.nicematrix.com/oidc/auth`
- Token endpoint: `https://id.nicematrix.com/oidc/token`
- Userinfo endpoint: `https://id.nicematrix.com/oidc/me`
- JWKS: `https://id.nicematrix.com/oidc/jwks`

## 推荐流程

- 使用 Authorization Code + PKCE
- 客户端只保存短期 token，refresh token 做安全存储
- Access Token 过期后调用 refresh 续期

## 需要后端/运维提供

- `client_id`
- `redirect_uri`（iOS/Android 各自）
- 支持的 scope（建议：`openid profile email offline_access`）

## 联调清单

- [ ] 登录成功可拿到 ID Token
- [ ] Access Token 可访问 `api.nicematrix.com`
- [ ] token 过期可 refresh
- [ ] 登出后本地 session 清理
