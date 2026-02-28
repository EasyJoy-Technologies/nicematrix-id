# API Documentation

This folder contains the API contract and integration-facing docs for NiceMatrix ID.

## Structure

- `v1/openapi.yaml` - machine-readable OpenAPI source of truth
- `v1/endpoints/` - human-readable endpoint notes and examples
- `CHANGELOG.md` - API-level changes for integrators

## Rules

1. Any API behavior change must update OpenAPI + endpoint docs in the same PR.
2. Keep request/response examples runnable for integration testing.
3. Breaking changes must be called out in `CHANGELOG.md`.

## Environments

- Production: `https://id.nicematrix.com`
- OIDC issuer: `https://id.nicematrix.com/oidc`
