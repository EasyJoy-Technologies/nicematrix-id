# Deploy

## Files

- `docker-compose.yml` - runtime stack
- `Dockerfile` - image build (currently branding-only patch)
- `.env.example` - environment template
- `nginx.id.nicematrix.conf.example` - reverse proxy sample

## Quick start

```bash
cp deploy/.env.example deploy/.env
cd deploy
docker compose up -d --build
```

## Upgrade notes

When upgrading Logto versions, run database alterations after image upgrade:

```bash
cd deploy
docker compose run --rm --entrypoint="" logto \
  node /etc/logto/packages/cli/bin/logto.js database alteration deploy next
```
