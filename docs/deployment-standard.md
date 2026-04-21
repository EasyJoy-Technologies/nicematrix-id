# NiceMatrix-ID 部署规范（Staging + Production）

> **最后更新**: 2026-04-20
> **适用范围**: 所有 NiceMatrix-ID（Logto 自编译）代码改动、配置更新、DB migration

本文档定义**唯一的**部署流程。任何绕过本流程的部署属于违规。

---

## 0. 环境总览

| 环境 | Host | IP | SSH Key | 运行路径 | env 文件 |
|---|---|---|---|---|---|
| **Staging** | `debian-8gb-hel1-1` (本地) | localhost | 直接 bash | `/root/projects/nicematrix-id` | `/etc/nicematrix/id.env` |
| **Production** | `debian-4gb-fsn1-1` | `46.224.6.74` | `/root/keys/nicematrix-id-prod_20260419_ed25519` | `/var/www/nicematrix-id` | `/etc/nicematrix/id.env` |

| 域名 | 指向 |
|---|---|
| `id.nicematrix.com` | Production |
| `id-staging.nicematrix.com` | Staging |
| `id.ej-mobile.cn` | QQ 回调中转（两边 nginx 都有 302 跳转规则） |

容器名在两边都是：`nicematrix-logto`（image: `nicematrix-logto:latest`）+ `nicematrix-id-postgres`。

---

## 1. 核心原则（Hard Rules）

1. **Staging 先部署并充分验证，才能推生产**。禁止直接 rebuild 生产或先部署生产。
2. **生产镜像必须和 staging 镜像完全一致**（同一个 image ID）。生产不重新 build，只传 staging 已验证的镜像。
3. **每次生产部署前，必须 tag 当前生产镜像为 backup**。tag 格式：`nicematrix-logto:prod-backup-<YYYYMMDD>`。
4. **DB migration 必须在 staging 先跑，生产跑之前审阅 diff**。SQL 必须幂等（`CREATE TABLE IF NOT EXISTS` / `ALTER ... IF NOT EXISTS`）。
5. **部署完成后必须执行健康检查 + 手动功能验证**。健康检查过不代表业务功能好。
6. **任何改动都要有回滚命令**，本文档定义的命令能让任何人在 30 秒内回滚。

---

## 2. 代码改动流程

1. 在 dev repo 改代码：`/root/projects/nicematrix-id/logto-custom/overrides/...`
2. Override 路径必须严格对应 upstream：`overrides/packages/<pkg>/src/<path>` 对应 `logto-upstream/packages/<pkg>/src/<path>`。
3. 所有改动限制在 `overrides/` 和 `logto-custom/` 内，不允许直接改 `logto-upstream/`。
4. 改完 commit（但是：本项目不是 git repo，目前用本地 diff 追踪。TODO：升级为 git repo）。

---

## 3. Staging 部署流程（必跑）

```bash
cd /root/projects/nicematrix-id
```

### 3.1 Build

```bash
docker compose --env-file /etc/nicematrix/id.env -f deploy/docker-compose.yml build logto 2>&1 | tee /tmp/logto-build.log
```

- 预计时长：8–12 分钟
- 关键验证点：
  - `packages/experience build: ✓ built in ...` 无 `error TS`
  - `packages/account build: ✓ built in ...` 无 `error TS`
  - `packages/console build: ✓ built in ...` 无 `error TS`
  - 最终 `Image nicematrix-logto:latest Built`

### 3.2 Tag + Recreate

```bash
# Tag backup so we can roll staging back too if needed
docker tag nicematrix-logto:latest nicematrix-logto:staging-backup-$(date +%Y%m%d-%H%M)

# Tag with a human-readable feature name (for long-term traceability)
docker tag nicematrix-logto:latest nicematrix-logto:<feature-name>-$(date +%Y%m%d)

# Recreate container (brief 10–15s downtime)
docker compose --env-file /etc/nicematrix/id.env -f deploy/docker-compose.yml up -d logto

# Wait for healthy
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 5
  STATUS=$(docker ps --filter name=nicematrix-logto --format "{{.Status}}")
  echo "[$i] $STATUS"
  echo "$STATUS" | grep -q healthy && break
done
```

### 3.3 DB Migration（如有）

```bash
# Always idempotent SQL
docker cp /root/projects/nicematrix-id/sql/<migration>.sql nicematrix-id-postgres:/tmp/
docker exec nicematrix-id-postgres psql -U logto -d logto -f /tmp/<migration>.sql
```

### 3.4 Staging 验证清单（必做）

| 检查项 | 命令 |
|---|---|
| OIDC discovery | `curl -sI https://id-staging.nicematrix.com/oidc/.well-known/openid-configuration \| head -3` → 200 |
| Container healthy | `docker ps --filter name=nicematrix-logto --format "{{.Status}}"` → `healthy` |
| Experience bundle updated | `docker exec nicematrix-logto ls /etc/logto/packages/experience/dist/assets/ \| grep '^index-.*\.js$' \| grep -v map` |
| Account Center bundle updated | `docker exec nicematrix-logto ls /etc/logto/packages/account/dist/assets/ \| grep '^index-.*\.js$' \| grep -v map` |
| **功能验证** | 在浏览器手动走一遍改动涉及的流程（登录 / 绑定 / 修改 profile 等） |

**功能验证未通过 → 禁止推生产**。

---

## 4. 生产部署流程

**前置条件**：staging 完成所有步骤 + 功能验证通过 + 至少 10 分钟冷却观察（看 staging log 无异常）。

### 4.1 传输镜像（staging → production）

```bash
# 1. 在 staging 机器上
docker save nicematrix-logto:latest -o /tmp/nicematrix-logto.tar

# 2. 传到生产机器
scp -i /root/keys/nicematrix-id-prod_20260419_ed25519 \
  /tmp/nicematrix-logto.tar \
  root@46.224.6.74:/tmp/
```

典型时长：image ~310MB，传输 ~5–10 秒（内网带宽好）。

### 4.2 生产机器部署

```bash
ssh -i /root/keys/nicematrix-id-prod_20260419_ed25519 root@46.224.6.74 << 'EOF'
set -e

# ✅ 1. Tag current prod image as backup
TODAY=$(date +%Y%m%d)
docker tag nicematrix-logto:latest nicematrix-logto:prod-backup-${TODAY}
echo "Backup tagged: prod-backup-${TODAY}"
docker images nicematrix-logto --format "  {{.Tag}}\t{{.ID}}" | head -5

# ✅ 2. Load new image
docker load -i /tmp/nicematrix-logto.tar

# ✅ 3. Feature tag
docker tag nicematrix-logto:latest nicematrix-logto:<feature-name>-${TODAY}

# ✅ 4. Recreate container
cd /var/www/nicematrix-id
docker compose --env-file /etc/nicematrix/id.env -f deploy/docker-compose.yml up -d logto

# ✅ 5. Wait for healthy
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 5
  STATUS=$(docker ps --filter name=nicematrix-logto --format "{{.Status}}")
  echo "[$i] $STATUS"
  echo "$STATUS" | grep -q healthy && break
done

# ✅ 6. Cleanup
rm /tmp/nicematrix-logto.tar
EOF
```

### 4.3 DB Migration（如有）

只有当 staging 已成功跑过且 SQL 幂等时执行：

```bash
scp -i /root/keys/nicematrix-id-prod_20260419_ed25519 \
  /root/projects/nicematrix-id/sql/<migration>.sql \
  root@46.224.6.74:/tmp/

ssh -i /root/keys/nicematrix-id-prod_20260419_ed25519 root@46.224.6.74 \
  'docker cp /tmp/<migration>.sql nicematrix-id-postgres:/tmp/ && \
   docker exec nicematrix-id-postgres psql -U logto -d logto -f /tmp/<migration>.sql'
```

### 4.4 生产验证清单（必做）

| 检查项 | 命令 |
|---|---|
| OIDC discovery | `curl -sI https://id.nicematrix.com/oidc/.well-known/openid-configuration \| head -3` → 200 |
| Container healthy | ssh prod `docker ps --filter name=nicematrix-logto --format "{{.Status}}"` → `healthy` |
| Error log scan | ssh prod `docker logs --since 2m nicematrix-logto 2>&1 \| grep -iE 'error \| exception'` → 只有 benign |
| **功能验证** | 浏览器真实用户账号走一遍关键路径 |

**出现 5xx / error 飙升 → 立即执行 §5 回滚**。

### 4.5 清理传输文件

```bash
rm /tmp/nicematrix-logto.tar  # staging
# Production 侧的 /tmp/nicematrix-logto.tar 在 4.2 末尾已删
```

---

## 5. 回滚流程（30 秒生效）

### 5.1 生产回滚

```bash
ssh -i /root/keys/nicematrix-id-prod_20260419_ed25519 root@46.224.6.74 \
  'docker tag nicematrix-logto:prod-backup-<YYYYMMDD> nicematrix-logto:latest && \
   cd /var/www/nicematrix-id && \
   docker compose --env-file /etc/nicematrix/id.env -f deploy/docker-compose.yml up -d logto'
```

### 5.2 Staging 回滚

```bash
cd /root/projects/nicematrix-id
docker tag nicematrix-logto:staging-backup-<timestamp> nicematrix-logto:latest
docker compose --env-file /etc/nicematrix/id.env -f deploy/docker-compose.yml up -d logto
```

### 5.3 DB Migration 回滚

- SQL 必须自带 DOWN 脚本（如 `sql/<migration>.down.sql`）
- DB migration **没有自动回滚** — 每个 SQL 文件必须在 design 阶段考虑向前兼容（旧代码 + 新 schema 能工作）
- 紧急情况：从备份恢复（见 `/root/backups/`）

---

## 6. 紧急情况决策树

| 症状 | 初步诊断 | 处置 |
|---|---|---|
| Container 启动失败 | `docker logs nicematrix-logto` 看原因 | 立即回滚镜像 |
| HTTP 500/502 飙升 | 最近一次部署问题 | 立即回滚镜像 |
| 只有特定 API 错（如本次 address）| 功能 bug | 评估是否影响 > 5% 请求：是 → 回滚；否 → 保留镜像 + 修代码 |
| DB 报表/列不存在 | Migration 漏跑 | 立即跑 migration（幂等 SQL 可直接执行）|
| 登录流程 broken | Experience 改动 bug | **立即回滚**（登录断了 = 所有用户受影响）|

---

## 7. 违规示例（禁止）

- ❌ 直接在生产机 `pnpm build` — **生产内存只 4GB 不够 build**
- ❌ 绕过 staging 直接传镜像到生产
- ❌ 修改 `/var/www/nicematrix-id/logto-upstream/` 或 `/var/www/nicematrix-id/logto-custom/` 的源码（生产路径只是"源码副本"，不用于构建）
- ❌ 用 `docker-compose down` 停服务做 migration（合法的方式是 `up -d` 自动重建 + 幂等 SQL）
- ❌ 部署完不做功能验证，只看 health check

---

## 8. 历史镜像 tag 命名约定

| 前缀 | 用途 | 保留期 |
|---|---|---|
| `nicematrix-logto:latest` | 当前活跃 | 永远 |
| `nicematrix-logto:prod-backup-<YYYYMMDD>` | 生产回滚 | 保留最近 3 个 |
| `nicematrix-logto:staging-backup-<YYYYMMDD-HHMM>` | Staging 回滚 | 保留最近 5 个 |
| `nicematrix-logto:<feature-name>-<YYYYMMDD>` | 功能版本追溯 | 永远 |

清理：
```bash
# List all nicematrix-logto tags with age
docker images nicematrix-logto --format "{{.Tag}}\t{{.CreatedAt}}" | sort
# Remove old backups
docker rmi nicematrix-logto:prod-backup-<OLD_DATE>
```

---

## 9. Checklist 模板（每次部署粘贴到工单/日志）

```
## 部署单：<功能名> - <YYYY-MM-DD HH:MM TZ>

### 改动
- [ ] 代码 override 文件列表：
- [ ] DB migration 文件（如有）：
- [ ] 影响的 API / 页面：
- [ ] 回滚方案：

### Staging
- [ ] Build 成功（`/tmp/logto-build.log` 无 error TS）
- [ ] Container healthy
- [ ] Bundle hash 已更新
- [ ] DB migration 成功（如有）
- [ ] 功能验证通过（具体验证步骤：...）
- [ ] 冷却观察 10 分钟，log 无异常

### Production
- [ ] 传 image tar 到生产机
- [ ] Tag `prod-backup-<YYYYMMDD>`
- [ ] Load + recreate container
- [ ] Container healthy
- [ ] DB migration 成功（如有）
- [ ] 功能验证通过
- [ ] 清理 /tmp 的 tar 文件

### 验证后
- [ ] Memory 记录（`memory/<YYYY-MM-DD>.md`）
- [ ] 更新本文档（如流程有补充）
```
