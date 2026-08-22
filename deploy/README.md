# Deploy

> ⚠️ 本目录为**部署文档与部署脚本专用**（deploy assets only）。
> - 仅放置部署相关文件：compose / env 模板 / nginx 示例 / deploy 脚本
> - 不放业务代码
> - 修改前请先确认当前生效的运行路径与 compose project，避免误改

完整部署手册见：[docs/deployment.md](../docs/deployment.md)

## 文件说明

- `docker-compose.yml` — 运行时 stack（postgres + logto）
- `.env.example` — 环境变量模板，复制为 `.env` 后填写
- `nginx.id.nicematrix.conf.example` — Nginx 反向代理示例配置
- `deploy.sh` — 仅做已构建镜像的安全切换、健康检查和自动回滚；绝不构建、绝不执行 DB alteration

## 快速参考

```bash
# 构建镜像（在项目根目录执行）
docker build -t nicematrix-logto:latest . -f logto-custom/Dockerfile

# staging 切换已构建且带描述性 tag 的候选镜像
./deploy/deploy.sh --target staging \
  --candidate nicematrix-logto:release-<git-sha>-<YYYYMMDD-HHMMSS> --apply

# 查看日志
docker logs nicematrix-logto --tail 50 -f

# DB alteration 是独立高风险步骤，先备份、审阅后单独执行
docker compose -p nicematrix-id run --rm --entrypoint="" logto \
  node /etc/logto/packages/cli/bin/logto.js database alteration deploy next
```

## 运行注意

- 建议始终使用 `-p nicematrix-id`，确保服务加入 `nicematrix-id_default` 网络。
- 若 Logto 日志出现 `ENOTFOUND postgres`，优先检查容器网络是否仍在 `nicematrix-id_default`。
