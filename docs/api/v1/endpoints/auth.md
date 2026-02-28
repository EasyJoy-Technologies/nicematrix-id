# Auth / Token Endpoints (v1)

## POST /oidc/token

- Purpose: Exchange auth code or refresh token for access tokens.
- Content-Type: `application/x-www-form-urlencoded`
- Common errors:
  - `invalid_target` (resource not granted in initial authorization)
  - `invalid_grant` (invalid/expired code or refresh token)

### Notes for integration

- Ensure requested `resource` values are included in the original authorization request.
- Keep PKCE verifier/code pair consistent for auth-code flow.
