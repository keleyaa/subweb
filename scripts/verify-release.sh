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

locked_images=$(node - <<'NODE'
const fs = require('node:fs');
const lock = JSON.parse(fs.readFileSync('deploy/versions.lock.json', 'utf8'));
for (const service of ['redis', 'subconverter', 'myurls']) {
  const image = lock.services[service].image;
  console.log(`${image.reference}@${image.digest}`);
}
NODE
)
set -- subweb:release-check $locked_images
candidate_image=$1
redis_image=$2
subconverter_image=$3
myurls_image=$4
stage image-security ./scripts/verify-image-security.sh "$candidate_image"
stage image-security-myurls ./scripts/verify-image-security.sh "$myurls_image"
stage image-security-redis ./scripts/verify-image-security.sh --ignorefile .trivyignore.redis "$redis_image"
stage image-security-subconverter ./scripts/verify-image-security.sh --ignorefile .trivyignore.subconverter "$subconverter_image"
stage evidence node scripts/verify-evidence.mjs

printf '%s\n' 'release verification=passed'
