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
stage compose npm run verify:compose
stage documentation npm run verify:docs
stage container ./scripts/verify-container.sh subweb:release-check
stage redis-operations ./scripts/verify-redis-operations.sh
stage integration ./scripts/verify-integrated-stack.sh
stage evidence node scripts/verify-evidence.mjs

printf '%s\n' 'release verification=passed'
