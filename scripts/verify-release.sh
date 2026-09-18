#!/bin/sh
set -eu

if [ ! -f .env ]; then
  APP_DOMAIN=app.release-validation.test
  API_DOMAIN=api.release-validation.test
  API_URL=https://api.release-validation.test
  SHORT_DOMAIN=short.release-validation.test
  TURNSTILE_SITE_KEY=release-validation-site-key
  TURNSTILE_SECRET_KEY=release-validation-secret-key
  IP_HASH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  REDIS_PASSWORD=release-validation-redis-password
  export APP_DOMAIN API_DOMAIN API_URL SHORT_DOMAIN TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY
  export IP_HASH_SECRET REDIS_PASSWORD
  printf '%s\n' 'release verification environment=ephemeral'
fi

runtime_image_env=$(node scripts/runtime-image-contract.mjs env)
unset REDIS_IMAGE SUBCONVERTER_IMAGE MYURLS_IMAGE
while IFS='=' read -r name value; do
  case "$name" in
    REDIS_IMAGE|SUBCONVERTER_IMAGE|MYURLS_IMAGE)
      export "$name=$value"
      ;;
    *)
      printf '%s\n' "release verification error: unexpected runtime image variable: $name" >&2
      exit 1
      ;;
  esac
done <<EOF
$runtime_image_env
EOF
: "${REDIS_IMAGE:?Runtime image contract did not provide REDIS_IMAGE}"
: "${SUBCONVERTER_IMAGE:?Runtime image contract did not provide SUBCONVERTER_IMAGE}"
: "${MYURLS_IMAGE:?Runtime image contract did not provide MYURLS_IMAGE}"

stage() {
  name=$1
  shift
  printf 'release verification stage=%s\n' "$name"
  "$@"
}

stage install npm ci
stage audit npm audit --audit-level=moderate
stage quality npm run verify:ci
stage integration npm run verify:integration
stage local npm run verify:local
stage browser npm run test:e2e
stage locks npm run verify:locks
stage production-readiness node scripts/verify-production-readiness.mjs
stage compose npm run verify:compose
stage documentation npm run verify:docs
stage gateway-image docker build --file Dockerfile --tag subweb:release-check .

candidate_image=subweb:release-check
stage image-security ./scripts/verify-image-security.sh "$candidate_image"
stage image-security-myurls ./scripts/verify-image-security.sh --ignorefile .trivyignore.myurls "$MYURLS_IMAGE"
stage image-security-redis ./scripts/verify-image-security.sh --ignorefile .trivyignore.redis "$REDIS_IMAGE"
stage image-security-subconverter ./scripts/verify-image-security.sh --ignorefile .trivyignore.subconverter "$SUBCONVERTER_IMAGE"
stage evidence node scripts/verify-evidence.mjs

printf '%s\n' 'release verification=passed'
