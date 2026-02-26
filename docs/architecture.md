# NiceMatrix 用户系统架构（Logto）

## 定位

`nicematrix-id` 是统一身份层（Identity Layer）：
- 统一登录入口
- 统一颁发 OIDC Token
- 统一管理用户、组织、角色

## 高层架构

```text
[Mobile/Web Apps] --OIDC--> [Logto @ id.nicematrix.com]
                                  |
                                  +--> ID Token / Access Token
                                  |
[Backend APIs @ api.nicematrix.com] <-- JWT 验签与授权
```

## 设计原则

1. 身份系统与业务系统解耦（认证不夹带业务逻辑）
2. 所有客户端通过标准 OIDC 接入
3. 权限由角色/组织统一建模，业务侧只消费声明（claims）
