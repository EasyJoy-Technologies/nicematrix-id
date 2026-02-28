# NiceMatrix ID

Self-hosted Logto setup for `id.nicematrix.com` with a maintainable custom layer.

## Repository Layout

```text
logto-upstream/   # Upstream Logto source mirror/submodule (no business edits)
logto-custom/     # NiceMatrix customizations (branding, controlled patches)
deploy/           # docker-compose, env, deployment scripts/config
docs/             # architecture + API + integration docs
```

## Workflow

1. Sync upstream source into `logto-upstream/`.
2. Keep custom changes in `logto-custom/` (minimal, reviewed, documented).
3. Build and deploy via `deploy/`.
4. Update docs in the same PR when behavior/API changes.

## Documentation

- API spec: `docs/api/v1/openapi.yaml`
- API guide: `docs/api/README.md`
- Endpoint docs: `docs/api/v1/endpoints/`
- Integration guide: `docs/integration/`
- Customization/patch notes: `docs/patches.md`

## Current status

- Running with Logto `1.37.0`
- Branding patch is visual-only (logo/favicon)
- Auth/token logic patches removed
