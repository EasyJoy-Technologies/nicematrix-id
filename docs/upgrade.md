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
