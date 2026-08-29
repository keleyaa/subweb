#!/bin/sh
set -eu

stage() {
  name=$1
  shift
  printf 'release verification stage=%s\n' "$name"
  "$@"
}

stage install npm ci
stage audit npm audit --audit-level=moderate
stage quality npm run verify
stage browser npm run test:e2e
stage locks npm run verify:locks
stage production-readiness node scripts/verify-production-readiness.mjs
stage compose npm run verify:compose
stage documentation npm run verify:docs
stage container ./scripts/verify-container.sh subweb:release-check
stage request-policy-container docker compose build request-policy
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
stage image-security ./scripts/verify-image-security.sh "$candidate_image" "$myurls_image"
stage image-security-request-policy ./scripts/verify-image-security.sh subweb-request-policy:local
stage image-security-redis ./scripts/verify-image-security.sh --ignorefile .trivyignore.redis "$redis_image"
stage image-security-subconverter ./scripts/verify-image-security.sh --ignorefile .trivyignore.subconverter "$subconverter_image"
stage redis-operations ./scripts/verify-redis-operations.sh
stage integration ./scripts/verify-integrated-stack.sh
stage evidence node scripts/verify-evidence.mjs

printf '%s\n' 'release verification=passed'
