#!/bin/sh

validate_release_version() (
  [ "$#" -eq 1 ] || return 1

  release_version=$1
  newline='
'

  case "$release_version" in
    *"$newline"*) return 1 ;;
  esac

  printf '%s\n' "$release_version" | LC_ALL=C grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
)

resolve_release_image() (
  release_version=${1-}

  if [ "$#" -ne 1 ] || ! validate_release_version "$release_version"; then
    printf 'Invalid release version (expected v<major>.<minor>.<patch>)\n' >&2
    return 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
    printf 'Docker with Buildx is required to resolve release images.\n' >&2
    return 1
  fi

  if ! docker buildx version >/dev/null 2>&1; then
    printf 'Docker Buildx is required to resolve release images.\n' >&2
    return 1
  fi

  if ! command -v gh >/dev/null 2>&1; then
    printf 'GitHub CLI is required to verify release provenance.\n' >&2
    return 1
  fi

  release_reference="ghcr.io/keleyaa/subweb:$release_version"
  sentinel=$(printf '\037')
  manifest_capture=$(
    if docker buildx imagetools inspect "$release_reference" --format '{{.Manifest.Digest}}'; then
      inspect_status=0
    else
      inspect_status=$?
    fi
    printf '%s%s' "$sentinel" "$inspect_status"
  )
  inspect_status=${manifest_capture##*"$sentinel"}
  manifest_digest=${manifest_capture%"$sentinel$inspect_status"}

  case "$inspect_status" in
    0) ;;
    *)
      printf 'Unable to resolve release image: %s\n' "$release_reference" >&2
      return 1
      ;;
  esac

  newline='
'
  case "$manifest_digest" in
    *"$newline") manifest_digest=${manifest_digest%"$newline"} ;;
  esac
  case "$manifest_digest" in
    *"$newline"*)
      printf 'Unable to resolve immutable digest for: %s\n' "$release_reference" >&2
      return 1
      ;;
  esac

  if ! printf '%s\n' "$manifest_digest" | LC_ALL=C grep -Eq '^sha256:[0-9a-f]{64}$'; then
    printf 'Unable to resolve immutable digest for: %s\n' "$release_reference" >&2
    return 1
  fi

  release_predicate_type='https://keleyaa.dev/subweb/release/v1'
  immutable_reference="ghcr.io/keleyaa/subweb@$manifest_digest"
  sentinel=$(printf '\037')
  attestation_capture=$(
    if gh attestation verify "oci://$immutable_reference" \
      --repo keleyaa/subweb \
      --signer-workflow keleyaa/subweb/.github/workflows/docker-build-release.yml \
      --predicate-type "$release_predicate_type" \
      --format json \
      --jq '.[] | .verificationResult.statement.predicate | [.releaseTag, .releaseRef, .imageDigest] | @tsv'; then
      attestation_status=0
    else
      attestation_status=$?
    fi
    printf '%s%s' "$sentinel" "$attestation_status"
  )
  attestation_status=${attestation_capture##*"$sentinel"}
  attestation_predicate=${attestation_capture%"$sentinel$attestation_status"}

  case "$attestation_status" in
    0) ;;
    *)
      printf 'Unable to verify release provenance for: %s\n' "$immutable_reference" >&2
      return 1
      ;;
  esac

  newline='
'
  case "$attestation_predicate" in
    *"$newline") attestation_predicate=${attestation_predicate%"$newline"} ;;
  esac
  tab=$(printf '\t')
  expected_attestation_predicate="$release_version${tab}refs/tags/$release_version${tab}$manifest_digest"
  if [ "$attestation_predicate" != "$expected_attestation_predicate" ]; then
    printf 'Signed release provenance does not match the requested release: %s\n' "$release_version" >&2
    return 1
  fi

  printf '%s\n' "$immutable_reference"
)
