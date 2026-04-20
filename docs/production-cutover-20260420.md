# NiceMatrix ID — 正式环境切换方案（2026-04-20）

> 范围：本次仅处理 **NiceMatrix ID / Logto**
> 
> 不包含：`api.nicematrix.com`、`m.nicematrix.com`、backend/admin-web 正式部署
>
> 可直接执行的命令清单见：`docs/production-execution-checklist-20260420.md`

---

## 1. 当前目标

- 现有测试环境域名：`id.nicematrix.com`
- 切换后测试环境域名：`id-staging.nicematrix.com`
- 正式环境域名：`id.nicematrix.com`
- 本次要求：**将现有 `id.nicematrix.com` 的系统数据整体迁移到正式环境**

---

## 2. 环境信息总表

### 2.1 正式环境

- Host: `46.224.6.74`
- IPv6: `2a01:4f8:c014:549d::1`
- SSH User: `root`
- SSH key: `/root/keys/nicematrix-id-prod_20260419_ed25519`

### 2.2 路径要求（与测试环境保持一致）

- 运行路径：`/var/www/nicematrix-id`
- compose env：`/etc/nicematrix/id.env`
- Nginx 路径：**与测试环境一致**
- 容器名：
  - `nicematrix-logto`
  - `nicematrix-id-postgres`

### 2.3 域名规划

- 生产：`https://id.nicematrix.com`
- 测试：`https://id-staging.nicematrix.com`
- QQ 回调中转域名：`https://id.ej-mobile.cn`

> QQ 登录现有方案依赖 `id.ej-mobile.cn` 回调后 302 回到 `id.nicematrix.com`，切换后必须确保该跳转已指向新的正式环境。

---

## 3. 切换原则

### 3.1 先搭正式，再切 DNS，再改旧环境域名

严格顺序：

1. 在正式环境完整部署并验证 `id.nicematrix.com` 对应服务
2. 从当前环境导出并导入现有 Logto 数据
3. 切换 `id.nicematrix.com` DNS 到正式环境
4. 确认正式环境稳定后，再将旧测试环境改为 `id-staging.nicematrix.com`

### 3.2 必须预留短暂停写窗口

因为这次是 **数据库整体搬迁**，所以正式切换前需要一个短暂停写窗口。

在最终导出数据库到切 DNS 完成之间，不应再允许旧环境继续发生新的关键写入，否则会丢失以下数据：

- 新注册用户
- 密码修改
- 社交绑定关系
- connector / application / webhook 后台配置变更
- 邮件模板 / branding / tenant 配置变更

> 简单说，这次不是双写迁移，而是一次性搬迁，必须接受一个短维护窗口。

---

## 4. 正式环境部署流程

## 4.1 服务器基础确认

在正式环境确认：

- `nginx` 已安装
- 目录结构与测试环境一致
- Docker / Docker Compose Plugin 可用
- `80/443` 已放行
- 可用磁盘、内存满足 Logto + Postgres 运行要求

建议检查：

```bash
uname -a
nginx -v
docker --version
docker compose version
mkdir -p /etc/nicematrix /var/www/nicematrix-id
```

---

## 4.2 部署代码到正式环境路径

> 正式环境路径必须保持和测试环境一致。

建议在正式环境放到：

```bash
/var/www/nicematrix-id
```

初始化：

```bash
cd /var/www
git clone git@github.com:EasyJoy-Technologies/nicematrix-id.git nicematrix-id
cd /var/www/nicematrix-id
git submodule update --init --recursive
```

---

## 4.3 配置正式环境 env

正式环境 env 文件：

```bash
/etc/nicematrix/id.env
```

建议从模板生成：

```bash
cp /var/www/nicematrix-id/deploy/.env.example /etc/nicematrix/id.env
vi /etc/nicematrix/id.env
```

正式环境重点字段：

```dotenv
LOGTO_ENDPOINT=https://id.nicematrix.com
LOGTO_COOKIE_SECRET=<沿用当前线上值，避免全部 session 失效>
LOGTO_ADMIN_DISABLE_LOCALHOST=false
POSTGRES_DB=logto
POSTGRES_USER=logto
POSTGRES_PASSWORD=<生产强密码>
POSTGRES_PORT=5432
LOGTO_PORT=3001
SMTP_HOST=<按现网填写>
SMTP_PORT=587
SMTP_USER=<按现网填写>
SMTP_PASS=<按现网填写>
SMTP_FROM=<按现网填写>
```

注意：

- `LOGTO_ENDPOINT` 生产保持 `https://id.nicematrix.com`
- `LOGTO_COOKIE_SECRET` 建议与当前线上保持一致，这样切换后已有登录态影响最小
- 若 SMTP 当前环境已在用，正式环境应同步原配置

---

## 4.4 构建并启动正式环境服务

在正式环境：

```bash
cd /var/www/nicematrix-id
docker build -t nicematrix-logto:latest . -f logto-custom/Dockerfile

cd /var/www/nicematrix-id/deploy
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env up -d postgres
```

确认 postgres 就绪后再继续。

---

## 5. 数据迁移流程

## 5.1 正式切换前准备

在切换窗口开始前：

- 停止对旧环境进行后台配置修改
- 尽量避免在旧环境继续注册/改密码/绑定社交账号
- 通知可能的联调人员短暂停止使用身份系统

## 5.2 从旧环境导出数据库

在当前旧环境：

```bash
docker exec nicematrix-id-postgres \
  pg_dump -U logto logto > /tmp/logto_backup_$(date +%Y%m%d_%H%M%S).sql
```

传到正式环境：

```bash
scp /tmp/logto_backup_*.sql root@46.224.6.74:/tmp/
```

## 5.3 导入到正式环境

在正式环境：

```bash
cat /tmp/logto_backup_*.sql | docker exec -i nicematrix-id-postgres \
  psql -U logto -d logto
```

导入后，再启动 Logto：

```bash
cd /var/www/nicematrix-id/deploy
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env up -d logto
```

如有版本升级所需 alteration，再执行：

```bash
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env run --rm --entrypoint="" logto \
  node /etc/logto/packages/cli/bin/logto.js database alteration deploy next
```

---

## 6. Nginx 与 SSL

因为正式环境 Nginx 路径与测试环境一致，所以直接按同样结构配置。

目标：

- `id.nicematrix.com` → `127.0.0.1:3001`
- SSL 在 Nginx 层终止
- 保留 `Host` / `X-Forwarded-*` 头

验证命令：

```bash
nginx -t
systemctl reload nginx
curl http://127.0.0.1:3001/oidc/.well-known/openid-configuration
```

证书建议：

```bash
certbot --nginx -d id.nicematrix.com
```

> 若 DNS 尚未切到正式机，证书申请放到切换时刻执行，或提前用 DNS challenge。

---

## 7. 正式切换前验证清单

在正式机本地先验证：

- [ ] `docker compose ps` 正常
- [ ] `docker logs nicematrix-logto --tail 50` 无持续报错
- [ ] `curl http://127.0.0.1:3001/oidc/.well-known/openid-configuration` 正常返回
- [ ] `https://id.nicematrix.com/console` 可打开（若已能经域名访问）
- [ ] 登录页 branding 正常
- [ ] 当前数据库中的 application / connector / webhook / email template 已在正式机可见
- [ ] `id.ej-mobile.cn` 的 QQ 回调 302 目标将指向新的正式环境入口

---

## 8. DNS 切换流程

切换时：

1. 将 `id.nicematrix.com` 的 A 记录指向 `46.224.6.74`
2. 将 AAAA 记录指向 `2a01:4f8:c014:549d::1`
3. 等待解析生效
4. 立即验证：

```bash
curl -I https://id.nicematrix.com
curl -I https://id.nicematrix.com/console
curl https://id.nicematrix.com/oidc/.well-known/openid-configuration
```

5. 浏览器验证：
   - 登录页
   - Console
   - 注册/登录
   - 邮件验证码
   - 社交登录（尤其 QQ）

---

## 9. 旧环境改为 staging 的流程

**这一步必须在正式环境确认稳定后再做。**

### 9.1 旧环境改域名

旧环境调整为：

- `LOGTO_ENDPOINT=https://id-staging.nicematrix.com`

并重新申请或配置 `id-staging.nicematrix.com` 的 SSL 证书。

### 9.2 旧环境 Nginx

旧环境 Nginx 改为服务：

- `id-staging.nicematrix.com`

### 9.3 旧环境数据建议

建议在正式切换后：

- 以切换时刻的数据为基础保留一份 staging 副本
- 之后 staging 与 production **不要继续共用数据库**

### 9.4 staging 用途

`id-staging.nicematrix.com` 只用于：

- connector 测试
- UI / branding 测试
- 新 patch 验证
- 与 backend/admin-web 的联调预演

不要把 staging 继续当正式入口使用。

---

## 10. 回滚预案

如果正式切换后短时间内发现严重问题：

1. 将 `id.nicematrix.com` DNS 指回旧环境
2. 恢复旧环境 Nginx / 域名配置
3. 重新验证登录与 OIDC
4. 排查正式环境问题后再择机重切

> 回滚前提是：旧环境在切换后不要立刻破坏原配置，至少保留一段可回切窗口。

---

## 11. 本次切换的明确边界

本次只完成：

- NiceMatrix ID 正式环境落地
- `id.nicematrix.com` 切到正式环境
- 旧测试环境改为 `id-staging.nicematrix.com`
- 保留当前用户系统全部历史数据

本次不做：

- backend 正式部署
- admin-web 正式部署
- backend 与新 ID 的联调上线切换

---

## 12. 推荐执行顺序（最简版）

1. 正式机准备目录、env、repo、docker、nginx
2. 正式机构建镜像并启动 postgres
3. 旧环境冻结变更，导出 logto DB
4. 正式机导入 DB，启动 logto
5. 正式机完成本地验证
6. 切 `id.nicematrix.com` DNS 到正式机
7. 验证正式登录流
8. 再把旧环境改成 `id-staging.nicematrix.com`
9. 最后再准备 backend/admin-web 联调接入正式 ID
