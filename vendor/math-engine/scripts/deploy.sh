#!/usr/bin/env bash
# CORTI 200.6-DEVOPS — release / deploy orchestrator.
#
# Usage:
#   scripts/deploy.sh tag <version>          tag a release
#   scripts/deploy.sh build                  build all four images
#   scripts/deploy.sh push                   push to $REGISTRY_URL
#   scripts/deploy.sh deploy                 deploy via $DEPLOY_TARGET
#   scripts/deploy.sh smoke <host>           smoke-test post-deploy
#   scripts/deploy.sh rollback <version>     roll back to a previous tag
#
# Env:
#   REGISTRY_URL    e.g. ghcr.io/myorg
#   DEPLOY_TARGET   "ssh:user@host" or "kubectl"
#   KUBE_CONTEXT    kube context name when DEPLOY_TARGET=kubectl
#   K8S_NAMESPACE   k8s namespace (default: sme)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REGISTRY_URL="${REGISTRY_URL:-}"
DEPLOY_TARGET="${DEPLOY_TARGET:-}"
K8S_NAMESPACE="${K8S_NAMESPACE:-sme}"

IMAGES=(server studio operator regulator)

die() {
  echo "deploy.sh: $*" >&2
  exit 1
}

require() {
  command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"
}

cmd_tag() {
  local version="${1:-}"
  [ -n "$version" ] || die "tag: provide a version (e.g. v1.2.3)"
  require git
  git diff --quiet || die "tag: working tree dirty"
  git tag -a "$version" -m "release $version"
  echo "tagged $version (push with: git push origin $version)"
}

cmd_build() {
  local version="${1:-latest}"
  require docker
  for img in "${IMAGES[@]}"; do
    local tag="slot-math-engine/${img}:${version}"
    echo "→ building $tag"
    docker build -f "Dockerfile.${img}" -t "$tag" .
  done
  echo "build complete: ${IMAGES[*]} (tag=$version)"
}

cmd_push() {
  local version="${1:-latest}"
  [ -n "$REGISTRY_URL" ] || die "push: set REGISTRY_URL"
  require docker
  for img in "${IMAGES[@]}"; do
    local local_tag="slot-math-engine/${img}:${version}"
    local remote_tag="${REGISTRY_URL}/${img}:${version}"
    docker tag "$local_tag" "$remote_tag"
    echo "→ pushing $remote_tag"
    docker push "$remote_tag"
  done
}

cmd_deploy() {
  local version="${1:-latest}"
  [ -n "$DEPLOY_TARGET" ] || die "deploy: set DEPLOY_TARGET"
  case "$DEPLOY_TARGET" in
    ssh:*)
      local host="${DEPLOY_TARGET#ssh:}"
      require ssh
      echo "→ deploying to $host"
      ssh "$host" "cd /opt/sme && docker compose pull && docker compose up -d"
      ;;
    kubectl)
      require kubectl
      for img in "${IMAGES[@]}"; do
        kubectl --namespace "$K8S_NAMESPACE" set image "deployment/$img" \
          "$img=${REGISTRY_URL}/${img}:${version}"
        kubectl --namespace "$K8S_NAMESPACE" rollout status "deployment/$img" --timeout=180s
      done
      ;;
    *)
      die "deploy: unknown DEPLOY_TARGET=$DEPLOY_TARGET"
      ;;
  esac
}

cmd_smoke() {
  local host="${1:-http://localhost:4000}"
  require curl
  echo "→ probing $host/api/health"
  local status
  status=$(curl -fsS "$host/api/health" | head -c 256 || true)
  [ -n "$status" ] || die "smoke: empty response"
  echo "ok: $status"
}

cmd_rollback() {
  local version="${1:-}"
  [ -n "$version" ] || die "rollback: provide a version"
  case "$DEPLOY_TARGET" in
    kubectl)
      require kubectl
      for img in "${IMAGES[@]}"; do
        kubectl --namespace "$K8S_NAMESPACE" rollout undo "deployment/$img"
      done
      ;;
    *)
      echo "rollback: re-deploying $version"
      cmd_deploy "$version"
      ;;
  esac
}

main() {
  local subcmd="${1:-}"
  shift || true
  case "$subcmd" in
    tag)      cmd_tag "$@" ;;
    build)    cmd_build "$@" ;;
    push)     cmd_push "$@" ;;
    deploy)   cmd_deploy "$@" ;;
    smoke)    cmd_smoke "$@" ;;
    rollback) cmd_rollback "$@" ;;
    *) cat <<EOF
deploy.sh — slot-math-engine release orchestrator.

Subcommands:
  tag <version>          Tag the current commit (e.g. v1.0.0).
  build [version]        Build all four images (default tag: latest).
  push [version]         Push to \$REGISTRY_URL.
  deploy [version]       Deploy via \$DEPLOY_TARGET (ssh:user@host or kubectl).
  smoke <host>           Hit /api/health.
  rollback <version>     Roll back to a previous version.

Env vars: REGISTRY_URL DEPLOY_TARGET KUBE_CONTEXT K8S_NAMESPACE
EOF
      exit 1
      ;;
  esac
}

main "$@"
