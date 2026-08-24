# MyUrls Frontend Gateway Design

## Goal

Expose the maintained MyUrls frontend at `SHORT_DOMAIN` while keeping MyUrls
private behind the Subweb Gateway. The short domain must support the UI, its
static assets, authenticated short creation, and existing short-code redirects.

## Boundaries

- `SHORT_DOMAIN/` serves MyUrls `index.html` through the Gateway.
- `/app.js`, `/styles.css`, and `/fonts/...` are proxied to the private MyUrls
  service.
- `POST /short` is a Gateway-owned proxy route. The Gateway replaces any
  client Authorization headers with the server-side MyUrls Bearer token.
- `POST /short` accepts requests only from the exact `SHORT_DOMAIN` Origin and
  allows the multipart form submitted by the MyUrls browser client.
- Existing `POST /short-api/short` remains the Subweb APP_DOMAIN integration
  endpoint and keeps its current APP_DOMAIN Origin and Content-Type policy.
- `GET /<shortKey>` remains the redirect route. Unknown paths remain 404.
- No Docker host port or direct MyUrls exposure is added.

## Request Flow

1. A browser opens `https://SHORT_DOMAIN/`.
2. Gateway proxies the HTML and local static assets to `myurls:8080`.
3. MyUrls frontend submits `multipart/form-data` to `POST /short`.
4. Gateway checks the request Origin and body size/content type, overwrites
   Authorization, and proxies `/short` to MyUrls.
5. MyUrls returns the short URL using `SHORT_DOMAIN`; Gateway returns the
   response without exposing the internal token.

## Failure and Security Rules

- Missing or non-matching Origin on `POST /short` returns 403.
- Unsupported body content type returns 415 before proxying.
- Methods other than POST on `/short` return 405.
- A client Authorization header is never forwarded.
- `/short-api/` remains a constrained 404 namespace except for its exact
  `/short-api/short` endpoint.
- The short-code matcher continues to allow only GET and HEAD.

## Verification

- Static routing contract tests prove the UI and asset routes exist and the
  fallback remains 404.
- Gateway routing tests prove `/short` is POST-only, origin-restricted,
  multipart-enabled, token-overwriting, and proxied to the exact upstream path.
- A real Nginx integration test serves a fixture HTML/static asset and checks
  allowed multipart creation, rejected Origin, rejected body type, and header
  replacement without exposing the token.
