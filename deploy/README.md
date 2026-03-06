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
- `deploy.sh` — 一键构建 + 启动 + DB alteration 脚本

## 快速参考

```bash
# 构建镜像（在项目根目录执行）
docker build -t nicematrix-logto:latest . -f logto-custom/Dockerfile

# 启动 stack（在 deploy/ 目录执行）
docker compose up -d

# 查看日志
docker logs nicematrix-logto --tail 50 -f

# DB alteration（升级 Logto 版本后执行）
docker compose run --rm --entrypoint="" logto \
  node /etc/logto/packages/cli/bin/logto.js database alteration deploy next
```
