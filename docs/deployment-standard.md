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
2. **生产镜像必须和 staging 镜像具有相同 RootFS Layers**。生产不重新 build，只传 staging 已验证的镜像；`docker save/load` 后 image ID 可能变化，不能用 image ID 判断漂移。
3. **每次生产部署前，必须 tag 当前生产镜像为 backup**。tag 格式：`nicematrix-logto:prod-backup-<YYYYMMDD>`。
4. **DB migration 必须在 staging 先跑，生产跑之前审阅 diff**。SQL 必须幂等（`CREATE TABLE IF NOT EXISTS` / `ALTER ... IF NOT EXISTS`）。
5. **部署完成后必须执行健康检查 + 手动功能验证**。健康检查过不代表业务功能好。
6. **任何改动都要有回滚命令**，本文档定义的命令能让任何人在 30 秒内回滚。

---

## 2. 代码改动流程

1. 在 dev repo 改代码：`/root/projects/nicematrix-id/logto-custom/overrides/...`
2. Override 路径必须严格对应 upstream：`overrides/packages/<pkg>/src/<path>` 对应 `logto-upstream/packages/<pkg>/src/<path>`。
3. 所有改动限制在 `overrides/` 和 `logto-custom/` 内，不允许直接改 `logto-upstream/`。
4. 改完提交到 Git；生产候选镜像必须能追溯到明确 commit 与描述性 tag。

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

### 3.2 Tag + Guarded switch

```bash
GIT_SHA=$(git rev-parse HEAD)
UTC_TAG=$(date -u +%Y%m%d-%H%M%S)
docker tag nicematrix-logto:latest nicematrix-logto:release-${GIT_SHA}-${UTC_TAG}
./deploy/deploy.sh --target staging \
  --candidate nicematrix-logto:release-${GIT_SHA}-${UTC_TAG} --apply
```

### 3.3 DB Migration（如有）

```bash
# Always idempotent SQL
docker cp /root/projects/nicematrix-id/sql/<migration>.sql nicematrix-id-postgres:/tmp/
docker exec nicematrix-id-postgres psql -U logto -d logto -f /tmp/<migration>.sql
```

Backend 访问 Logto DB 时必须使用独立的 `nicematrix_backend_maintenance`
最小权限角色，不得复用 Logto owner。该角色的 SQL 只声明权限，密码由运维单独生成并
写入 Backend 的 mode `600` env。轮换密码时须先用候选连接串执行只读 `SELECT 1`，
再原子替换 `LOGTO_DB_URL` 并仅重启 Backend；至少观察两个后台扫描周期。Logto owner
密码轮换与该角色相互独立，轮换后仍须分别验证 Logto 健康检查和 Backend maintenance
连接，禁止只验证其中一方。

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

# ✅ 1. Load new image；运行中的旧容器 image ID 不受 tag 覆盖影响
docker load -i /tmp/nicematrix-logto.tar

# ✅ 2. 生成不可变 release tag
UTC_TAG=$(date -u +%Y%m%d-%H%M%S)
docker tag nicematrix-logto:latest nicematrix-logto:release-<git-sha>-${UTC_TAG}

# ✅ 3. 安全脚本从运行中容器 image ID 建 rollback tag，再切换候选镜像
cd /var/www/nicematrix-id
./deploy/deploy.sh --target prod-1 --candidate nicematrix-logto:release-<git-sha>-${UTC_TAG} --apply

# ✅ 4. Cleanup
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
   docker exec nicematrix-id-postgres psql -v ON_ERROR_STOP=1 -U logto -d logto -f /tmp/<migration>.sql'
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
  'cd /var/www/nicematrix-id && ./deploy/deploy.sh --target prod-1 \
   --candidate nicematrix-logto:rollback-prod-1-<UTC> --apply'
```

### 5.2 Staging 回滚

```bash
cd /root/projects/nicematrix-id
./deploy/deploy.sh --target staging \
  --candidate nicematrix-logto:rollback-staging-<UTC> --apply
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
| `nicematrix-logto:rollback-<target>-<UTC>` | 自动回滚锚 | 每环境最近 3 个 |
| `nicematrix-logto:release-<commit>-<UTC>` | 可追溯候选/历史版本 | 最近 3 个 |

清理：
```bash
# List all nicematrix-logto tags with age
docker images nicematrix-logto --format "{{.Tag}}\t{{.CreatedAt}}" | sort
# deploy.sh 在验证成功后自动清理旧 rollback/release tag；失败回滚时不清理
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
