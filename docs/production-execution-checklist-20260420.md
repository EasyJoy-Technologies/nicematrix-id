# NiceMatrix ID — 正式机执行清单（2026-04-20）

> 目标：把当前 `id.nicematrix.com` 的现有系统数据迁移到正式环境，并在验证后将旧环境改为 `id-staging.nicematrix.com`

> 对应方案文档：`docs/production-cutover-20260420.md`

---

## 0. 固定信息

### 正式环境
- IPv4: `46.224.6.74`
- IPv6: `2a01:4f8:c014:549d::1`
- User: `root`
- SSH key: `/root/keys/nicematrix-id-prod_20260419_ed25519`

### 固定路径（必须与测试环境一致）
- 运行目录：`/var/www/nicematrix-id`
- env 文件：`/etc/nicematrix/id.env`
- Nginx 路径：与测试环境一致

### 固定容器名
- `nicematrix-logto`
- `nicematrix-id-postgres`

### 域名规划
- 正式：`id.nicematrix.com`
- 测试：`id-staging.nicematrix.com`
- QQ 回调中转：`id.ej-mobile.cn`

---

## 1. 连接正式机

在当前工作机执行：

```bash
ssh -i /root/keys/nicematrix-id-prod_20260419_ed25519 root@46.224.6.74
```

如需强制指定新 key：

```bash
ssh -F /dev/null -i /root/keys/nicematrix-id-prod_20260419_ed25519 -o IdentitiesOnly=yes root@46.224.6.74
```

---

## 2. 正式机基础检查

在正式机执行：

```bash
uname -a
nginx -v
docker --version
docker compose version
mkdir -p /etc/nicematrix /var/www
```

确认：
- `nginx` 已安装
- `docker` / `docker compose` 可用
- 目录结构正常

---

## 3. 拉取代码到正式环境固定路径

在正式机执行：

```bash
cd /var/www
if [ ! -d /var/www/nicematrix-id/.git ]; then
  GIT_SSH_COMMAND='ssh -F /dev/null -i /root/keys/nicematrix-id-prod_20260419_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
    git clone git@github.com:EasyJoy-Technologies/nicematrix-id.git /var/www/nicematrix-id
fi

cd /var/www/nicematrix-id
GIT_SSH_COMMAND='ssh -F /dev/null -i /root/keys/nicematrix-id-prod_20260419_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  git fetch --all --prune
GIT_SSH_COMMAND='ssh -F /dev/null -i /root/keys/nicematrix-id-prod_20260419_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  git reset --hard origin/main
git submodule update --init --recursive
```

验证：

```bash
cd /var/www/nicematrix-id
git rev-parse --short HEAD
```

---

## 4. 准备正式环境 env

在正式机执行：

```bash
cp /var/www/nicematrix-id/deploy/.env.example /etc/nicematrix/id.env
vi /etc/nicematrix/id.env
chmod 600 /etc/nicematrix/id.env
```

至少填写这些值：

```dotenv
LOGTO_ENDPOINT=https://id.nicematrix.com
LOGTO_COOKIE_SECRET=<沿用当前线上值>
LOGTO_ADMIN_DISABLE_LOCALHOST=false
POSTGRES_DB=logto
POSTGRES_USER=logto
POSTGRES_PASSWORD=<生产强密码>
POSTGRES_PORT=5432
LOGTO_PORT=3001
SMTP_HOST=<当前线上值>
SMTP_PORT=<当前线上值>
SMTP_USER=<当前线上值>
SMTP_PASS=<当前线上值>
SMTP_FROM=<当前线上值>
```

核对：
- `LOGTO_ENDPOINT` 必须是 `https://id.nicematrix.com`
- `LOGTO_COOKIE_SECRET` 建议与当前环境一致
- SMTP 如线上已启用，应同步

---

## 5. 正式机预启动 Postgres

在正式机执行：

```bash
cd /var/www/nicematrix-id
docker build -t nicematrix-logto:latest . -f logto-custom/Dockerfile

cd /var/www/nicematrix-id/deploy
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env up -d postgres
```

等待并检查：

```bash
docker ps --filter name=nicematrix-id-postgres
docker logs nicematrix-id-postgres --tail 30
```

---

## 6. 切换窗口开始前的冻结动作

在旧环境开始切换前，先确认：

- 停止对 Logto 后台做配置修改
- 暂停联调人员使用身份系统
- 避免继续发生：注册、改密码、绑定社交账号、修改 connector/application/webhook

> 这是一次性 DB 搬迁，不是双写。

---

## 7. 从旧环境导出现有数据

在旧环境执行：

```bash
docker exec nicematrix-id-postgres \
  pg_dump -U logto logto > /tmp/logto_backup_$(date +%Y%m%d_%H%M%S).sql
ls -lh /tmp/logto_backup_*.sql | tail -1
```

传到正式环境：

```bash
scp /tmp/logto_backup_*.sql root@46.224.6.74:/tmp/
```

---

## 8. 导入到正式环境

在正式机执行：

```bash
cat /tmp/logto_backup_*.sql | docker exec -i nicematrix-id-postgres \
  psql -U logto -d logto
```

导入后启动 Logto：

```bash
cd /var/www/nicematrix-id/deploy
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env up -d logto
```

如需 schema alteration：

```bash
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env run --rm --entrypoint="" logto \
  node /etc/logto/packages/cli/bin/logto.js database alteration deploy next
```

---

## 9. 正式机本地验证

在正式机执行：

```bash
cd /var/www/nicematrix-id/deploy
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env ps
docker logs nicematrix-logto --tail 50
curl http://127.0.0.1:3001/oidc/.well-known/openid-configuration
```

确认：
- postgres healthy
- logto 正常启动
- well-known 返回正常 JSON

---

## 10. Nginx 与证书

在正式机执行：

```bash
nginx -t
systemctl reload nginx
```

如果 DNS 已切到正式机，再申请证书：

```bash
certbot --nginx -d id.nicematrix.com
```

如果 DNS 还没切，不要现在强行走 http-01，避免失败。

---

## 11. DNS 切换

将：
- A 记录 -> `46.224.6.74`
- AAAA 记录 -> `2a01:4f8:c014:549d::1`

切完后验证：

```bash
curl -I https://id.nicematrix.com
curl -I https://id.nicematrix.com/console
curl https://id.nicematrix.com/oidc/.well-known/openid-configuration
```

---

## 12. 浏览器人工验证

切 DNS 后立即验证：

- [ ] 登录页能打开
- [ ] `/console` 能打开
- [ ] 用户可登录
- [ ] 新用户可注册（如当前开放）
- [ ] 邮件验证码正常
- [ ] 已有 connector 正常可见
- [ ] QQ 登录正常

### QQ 特别检查
确认 `id.ej-mobile.cn` 的 nginx 跳转最终落到新的正式环境，而不是旧测试环境。

---

## 13. 旧环境改为 staging

等正式环境稳定后，再到旧环境执行：

### 13.1 改 env

将旧环境里的：

```dotenv
LOGTO_ENDPOINT=https://id-staging.nicematrix.com
```

### 13.2 改 Nginx
将旧环境站点改为：

- `id-staging.nicematrix.com`

### 13.3 申请 staging 证书

```bash
certbot --nginx -d id-staging.nicematrix.com
```

### 13.4 重启旧环境

```bash
cd /var/www/nicematrix-id/deploy
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env up -d
nginx -t && systemctl reload nginx
```

---

## 14. 切换后收尾

确认：
- 正式：`id.nicematrix.com` 已在新机
- 测试：`id-staging.nicematrix.com` 已在旧机
- staging 不再与 production 共用写入流量
- 旧环境仍可用于联调，但不再作为正式入口

---

## 15. 最短执行顺序

1. SSH 登录正式机
2. 准备 `/var/www/nicematrix-id`
3. 配 `/etc/nicematrix/id.env`
4. 构建镜像并起 postgres
5. 旧环境冻结变更
6. 导出 DB 并传到正式机
7. 导入 DB，启动 logto
8. 本地验证正式机
9. 切 DNS 到正式机
10. 验证登录流
11. 再把旧环境改成 `id-staging.nicematrix.com`

---

## 16. 回滚预案

如果正式切换异常：

1. 把 `id.nicematrix.com` DNS 指回旧环境
2. 恢复旧环境原 Nginx / 域名
3. 验证登录与 OIDC
4. 排查正式机问题后再重切
