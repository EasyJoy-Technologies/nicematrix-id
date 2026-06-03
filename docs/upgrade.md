# Upstream Upgrade Workflow

## Current upstream source mode

`logto-upstream/` is a Git submodule pinned to a specific upstream tag.

## First clone

```bash
git clone git@github.com:EasyJoy-Technologies/nicematrix-id.git
cd nicematrix-id
git submodule update --init --recursive
```

## Upgrade Logto upstream version

```bash
cd logto-upstream
git fetch --tags
git checkout v1.37.0   # replace with target version
cd ..
git add logto-upstream
git commit -m "chore: bump logto-upstream to vX.Y.Z"
```

## After upgrade

1. Rebuild image from `deploy/`
2. Run DB alterations:
   ```bash
   cd deploy
   docker compose run --rm --entrypoint="" logto \
     node /etc/logto/packages/cli/bin/logto.js database alteration deploy next
   ```
3. Run smoke tests: sign-in, menu navigation, core admin pages
4. Update docs/api + docs/integration if behavior changed
5. **Bump `LOGTO_VERSION` in every NiceMatrix-Backend host `/etc/nicematrix/backend.env`**
   (prod-1 `46.224.6.74`, prod-3 `47.100.182.243`, staging `debian-8gb-hel1-1`) to the new
   version, then `systemctl restart nicematrix-backend.service`. This env is the single
   authoritative source for the admin dashboard “ID System Status” tile
   (`GET /v1/admin/id-system/status`) — the self-compiled Logto image exposes no version
   over its API, so a stale env makes the dashboard show the wrong version.
