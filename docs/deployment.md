# NiceMatrix ID — 部署手册

> 适用版本：Logto 1.37.0 · 最后更新：2026-03

---

## 目录

1. [环境要求](#1-环境要求)
2. [首次克隆与初始化](#2-首次克隆与初始化)
3. [配置环境变量](#3-配置环境变量)
4. [构建镜像](#4-构建镜像)
5. [启动服务](#5-启动服务)
6. [Nginx 反向代理](#6-nginx-反向代理)
7. [数据库初始化](#7-数据库初始化)
8. [验证清单](#8-验证清单)
9. [迁移到新服务器](#9-迁移到新服务器)
10. [常见问题](#10-常见问题)

---

## 1. 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Docker | 24+ | 含 BuildKit |
| Docker Compose Plugin | v2.20+ | `docker compose`（非 `docker-compose`）|
| Nginx | 1.18+ | 反向代理，SSL 终止 |
| Certbot / ACME | 任意 | 申请 SSL 证书 |
| 系统内存 | 2 GB+ | 构建阶段峰值约 1.5 GB |
| 磁盘空间 | 5 GB+ | 镜像 + 数据卷 |

开放端口：
- `80 / 443`：Nginx 对外
- `3001`（本机 127.0.0.1）：Logto 内部监听，不对外暴露

---

## 2. 首次克隆与初始化

```bash
git clone git@github.com:EasyJoy-Technologies/nicematrix-id.git
cd nicematrix-id

# 初始化 logto-upstream submodule（源码约 300 MB，首次较慢）
git submodule update --init --recursive
```

目录结构说明：

```
logto-upstream/          # Logto 上游源码（只读，不要在此处做改动）
logto-custom/
  overrides/             # NiceMatrix 定制源码（按相对路径覆盖 upstream）
  Dockerfile             # 构建入口
deploy/
  docker-compose.yml     # 运行时 stack 定义
  .env.example           # 环境变量模板
  nginx.id.nicematrix.conf.example
docs/                    # 本文档及其他设计文档
```

---

## 3. 配置环境变量

```bash
cp deploy/.env.example deploy/.env
vi deploy/.env
```

各字段说明：

```dotenv
# 对外访问的完整 URL（含协议，不含尾斜杠）
LOGTO_ENDPOINT=https://id.nicematrix.com

# Session 签名密钥，生产环境必须替换为随机强密钥
# 生成方式：openssl rand -base64 32
LOGTO_COOKIE_SECRET=<随机字符串>

# OSS 模式固定为 false
LOGTO_ADMIN_DISABLE_LOCALHOST=false

# Logto 内部监听端口（容器内，映射到宿主机 3001）
LOGTO_PORT=3001

# PostgreSQL 数据库配置
POSTGRES_DB=logto
POSTGRES_USER=logto
POSTGRES_PASSWORD=<随机强密码>
POSTGRES_PORT=5432

# （可选）SMTP 邮件，用于验证码/密码重置
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=no-reply@example.com
SMTP_PASS=<smtp密码>
SMTP_FROM=NiceMatrix <no-reply@example.com>
```

---

## 4. 构建镜像

构建耗时约 2–3 分钟（首次含依赖安装）：

```bash
cd /path/to/nicematrix-id
docker build -t nicematrix-logto:latest . -f logto-custom/Dockerfile
```

> **注意**：构建上下文是项目根目录（`.`），不是 `deploy/` 或 `logto-custom/`。

---

## 5. 启动服务

### 5.1 启动 PostgreSQL

```bash
cd deploy
docker compose up -d postgres
# 等待数据库就绪（约 5 秒）
sleep 5
```

### 5.2 启动 Logto

**重要：** Logto 容器必须和 postgres 在同一个 Docker 网络中，才能通过主机名 `postgres` 访问数据库。
`docker compose up` 会自动创建 `nicematrix-id_default` 网络并将两个服务加入其中，因此**始终使用 compose 启动，不要手动 `docker run`**。

```bash
cd deploy
docker compose up -d logto
```

### 5.3 查看状态

```bash
docker compose ps
docker logs nicematrix-logto --tail 30
```

正常启动后日志末尾应出现类似：

```
App is running at http://localhost:3001
```

---

## 6. Nginx 反向代理

复制示例配置并按需修改：

```bash
cp deploy/nginx.id.nicematrix.conf.example /etc/nginx/sites-available/id.nicematrix.com
# 编辑 server_name 为实际域名
vi /etc/nginx/sites-available/id.nicematrix.com
ln -s /etc/nginx/sites-available/id.nicematrix.com /etc/nginx/sites-enabled/
```

申请 SSL 证书（使用 certbot）：

```bash
certbot --nginx -d id.nicematrix.com
```

Nginx 配置关键点：

```nginx
server {
  listen 443 ssl;
  server_name id.nicematrix.com;

  # certbot 自动填写 ssl_certificate / ssl_certificate_key

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> `TRUST_PROXY_HEADER=true` 已在 docker-compose.yml 中设置，Logto 会正确识别真实 IP 和 HTTPS 协议。

重载 Nginx：

```bash
nginx -t && systemctl reload nginx
```

---

## 7. 数据库初始化

**首次部署**时，Logto 会在启动时自动初始化数据库 schema，无需手动操作。

**升级 Logto 版本**后，需要跑 alteration 脚本：

```bash
cd deploy
docker compose run --rm --entrypoint="" logto \
  node /etc/logto/packages/cli/bin/logto.js database alteration deploy next
```

---

## 8. 验证清单

部署完成后逐项确认：

- [ ] `curl -I https://id.nicematrix.com` 返回 HTTP 302
- [ ] 浏览器打开 `https://id.nicematrix.com` 显示 NiceMatrix 登录页
- [ ] 浏览器标题为 `NiceMatrix Console`（而非 `Logto Console`）
- [ ] 加载动画中 Logo 大小正常（不占满屏幕）
- [ ] 能正常注册 / 登录账号
- [ ] Admin Console `https://id.nicematrix.com/console` 可访问

---

## 9. 迁移到新服务器

### 9.1 迁移数据库（PostgreSQL 数据卷）

在旧服务器上导出：

```bash
docker exec nicematrix-id-postgres \
  pg_dump -U logto logto > logto_backup_$(date +%Y%m%d).sql
```

传输到新服务器：

```bash
scp logto_backup_*.sql user@new-server:/tmp/
```

在新服务器上，先启动 postgres，再导入：

```bash
cd deploy
docker compose up -d postgres
sleep 5
cat /tmp/logto_backup_*.sql | docker exec -i nicematrix-id-postgres \
  psql -U logto -d logto
```

### 9.2 新服务器完整流程

```bash
# 1. 克隆代码
git clone git@github.com:EasyJoy-Technologies/nicematrix-id.git
cd nicematrix-id
git submodule update --init --recursive

# 2. 配置环境

cp deploy/.env.example deploy/.env
# 编辑 .env 填入正确的值
vi deploy/.env

# 3. 构建镜像
docker build -t nicematrix-logto:latest . -f logto-custom/Dockerfile

# 4. 启动
cd deploy
docker compose up -d postgres
sleep 5

# 5. 导入数据库（如需迁移数据）
cat /tmp/logto_backup_*.sql | docker exec -i nicematrix-id-postgres psql -U logto -d logto

# 6. 启动 Logto
docker compose up -d logto

# 7. 配置 Nginx + SSL（见第 6 节）
```

### 9.3 注意事项

- `LOGTO_COOKIE_SECRET` 迁移时保持一致，否则现有 session 全部失效，用户需重新登录
- `LOGTO_ENDPOINT` 改为新域名时，所有 OIDC 应用的 redirect URI 也需要同步更新

---

## 10. 常见问题

### 容器启动后反复重启，日志报 `ENOTFOUND postgres`

**原因**：Logto 容器和 postgres 容器不在同一个 Docker 网络。

**解决**：确保两个容器都通过同一个 `docker compose` 启动（在 `deploy/` 目录下执行）。
不要用 `docker run` 手动启动 logto 容器，否则它会加入默认网络而非 compose 网络。

---

### 502 Bad Gateway

排查步骤：
1. `docker ps | grep nicematrix-logto` — 确认容器在运行且不是 Restarting 状态
2. `docker logs nicematrix-logto --tail 30` — 查看启动日志
3. `curl http://127.0.0.1:3001` — 在宿主机上直接测试 Logto 端口

---

### 首次启动后 Admin Console 无法登录

首次启动时，Logto 会输出一次性管理员邀请链接：

```bash
docker logs nicematrix-logto 2>&1 | grep -i "admin\|invitation\|http"
```

找到类似 `https://id.nicematrix.com/console/...` 的链接，用浏览器打开完成初始设置。

---

### 忘记更新 patches.md

每次在 `logto-custom/overrides/` 添加或修改覆盖文件后，同步更新 `docs/patches.md`。
参考格式见该文件现有条目。
