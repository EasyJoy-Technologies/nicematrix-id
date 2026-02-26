# NiceMatrix 用户系统 (`nicematrix-id`)

基于 **Logto** 的统一身份系统，用于支撑 NiceMatrix 全部产品与网站登录。

- 生产域名：`id.nicematrix.com`
- 目标：统一登录、统一用户身份、统一组织与权限模型

## 仓库职责

本仓库只负责身份系统相关能力：
- Logto 自托管部署配置
- 认证参数管理（OIDC/OAuth2）
- 登录体验与品牌化配置
- 给客户端/服务端的接入文档

> 业务数据、订阅、后台管理逻辑不在本仓库，见 `nicematrix-backend`。

## 目录结构

```
.
├── deploy/                    # 部署相关配置（Docker/Nginx/Env）
├── docs/
│   ├── architecture.md        # 架构说明
│   └── integration/
│       └── mobile-oidc.md     # 手机端接入说明
├── scripts/                   # 运维脚本
├── .env.example
└── docker-compose.yml
```

## 快速开始（自托管）

1. 复制环境变量模板：
   ```bash
   cp .env.example .env
   ```
2. 修改 `.env` 中域名、数据库密码、管理员初始配置。
3. 启动：
   ```bash
   docker compose up -d
   ```

## 文档

- 架构说明：`docs/architecture.md`
- 手机端 OIDC 接入：`docs/integration/mobile-oidc.md`

## 开发约定

- 任何认证协议参数变更，都必须同步更新文档。
- 回调 URI 变更必须在 PR 描述中列明影响范围（iOS/Android/Web）。
