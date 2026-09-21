#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
PROJECT_DIRECTORY=$(CDPATH='' cd -- "$SCRIPT_DIRECTORY/.." && pwd -P)
cd "$PROJECT_DIRECTORY"
# shellcheck source=lib/path-lock.sh
. "$SCRIPT_DIRECTORY/lib/path-lock.sh"

VERSION_LOCK_SOURCE=$PROJECT_DIRECTORY/deploy/versions.lock.json
VERSION_LOCK_SNAPSHOT=''
VERSION_LOCK_DIRECTORY=''

cleanup_release_verification() {
  cleanup_status=$?
  trap - 0 HUP INT TERM
  if [ -n "$VERSION_LOCK_SNAPSHOT" ] && [ -f "$VERSION_LOCK_SNAPSHOT" ]; then
    if ! cmp -s "$VERSION_LOCK_SOURCE" "$VERSION_LOCK_SNAPSHOT"; then
      printf '%s\n' 'release verification failed: version lock changed during verification.' >&2
      cleanup_status=1
    fi
    rm -f -- "$VERSION_LOCK_SNAPSHOT" || cleanup_status=1
  fi
  release_path_lock "$VERSION_LOCK_DIRECTORY" || cleanup_status=1
  exit "$cleanup_status"
}
trap cleanup_release_verification 0 HUP INT TERM

acquire_path_lock "$VERSION_LOCK_SOURCE" \
  || { printf '%s\n' 'release verification failed: unable to lock version locks.' >&2; exit 1; }
VERSION_LOCK_DIRECTORY=$PATH_LOCK_DIRECTORY
VERSION_LOCK_SNAPSHOT=$(mktemp "${TMPDIR:-/tmp}/subweb-versions.lock.XXXXXX") \
  || { printf '%s\n' 'release verification failed: unable to create version-lock snapshot.' >&2; exit 1; }
chmod 0600 "$VERSION_LOCK_SNAPSHOT"
cp "$VERSION_LOCK_SOURCE" "$VERSION_LOCK_SNAPSHOT"
if ! cmp -s "$VERSION_LOCK_SOURCE" "$VERSION_LOCK_SNAPSHOT"; then
  printf '%s\n' 'release verification failed: version lock changed while being snapshotted.' >&2
  exit 1
fi
VERSION_LOCK_FILE=$VERSION_LOCK_SNAPSHOT
export VERSION_LOCK_FILE

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
stage runtime-image-provenance node scripts/runtime-image-contract.mjs verify --lock "$VERSION_LOCK_FILE"
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
