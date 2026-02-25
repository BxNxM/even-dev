#!/usr/bin/env bash
set -euo pipefail

SEED_DIR="/opt/even-dev-seed"
RUNTIME_DIR="/opt/webui-docker"
WORKSPACE_DIR="/workspace/even-dev"
WORKSPACE_LOCK_STALE_SECS="${WORKSPACE_LOCK_STALE_SECS:-30}"

mkdir -p "$WORKSPACE_DIR"
WORKSPACE_LOCKDIR="$WORKSPACE_DIR/.webui-docker-lock"

acquire_workspace_lock() {
  local waited=0
  while ! mkdir "$WORKSPACE_LOCKDIR" 2>/dev/null; do
    # Recover from stale lock dir left by a crashed/interrupted container.
    if [ -d "$WORKSPACE_LOCKDIR" ]; then
      if find "$WORKSPACE_LOCKDIR" -maxdepth 0 -mmin +"$((WORKSPACE_LOCK_STALE_SECS / 60))" >/dev/null 2>&1; then
        echo "[webui-docker] Removing stale workspace lock..." >&2
        rmdir "$WORKSPACE_LOCKDIR" 2>/dev/null || true
      fi
    fi
    sleep 0.2
    waited=$((waited + 1))
    if [ "$waited" -eq 50 ]; then
      echo "[webui-docker] Waiting for workspace lock..." >&2
    fi
    if [ "$waited" -gt 300 ]; then
      echo "[webui-docker] Lock wait timeout; forcing stale lock cleanup" >&2
      rmdir "$WORKSPACE_LOCKDIR" 2>/dev/null || true
      waited=0
    fi
  done
}

release_workspace_lock() {
  rmdir "$WORKSPACE_LOCKDIR" 2>/dev/null || true
}

seed_workspace_if_needed() {
  # On first run with a named volume, seed from the image. Also ensure docker runtime assets
  # are present inside the workspace for docs/discoverability.
  if [ ! -f "$WORKSPACE_DIR/package.json" ]; then
    echo "[webui-docker] Seeding workspace volume from image"
    cp -a "$SEED_DIR"/. "$WORKSPACE_DIR"/
  fi

  mkdir -p "$WORKSPACE_DIR/misc/webui-docker"
  # Copy files one-by-one to avoid cp directory race errors across concurrent containers.
  find "$RUNTIME_DIR" -type d -print | while IFS= read -r src_dir; do
    rel="${src_dir#$RUNTIME_DIR/}"
    if [ "$src_dir" = "$RUNTIME_DIR" ]; then
      continue
    fi
    mkdir -p "$WORKSPACE_DIR/misc/webui-docker/$rel"
  done
  find "$RUNTIME_DIR" -type f -print | while IFS= read -r src_file; do
    rel="${src_file#$RUNTIME_DIR/}"
    dst="$WORKSPACE_DIR/misc/webui-docker/$rel"
    tmp="${dst}.tmp.$$"
    cp "$src_file" "$tmp"
    mv -f "$tmp" "$dst"
  done

  # Keep docker-managed launcher compatibility in persistent volumes:
  # older volumes may contain a start-even.sh without --web-only support.
  if [ -f "$SEED_DIR/start-even.sh" ]; then
    if [ ! -f "$WORKSPACE_DIR/start-even.sh" ] || ! grep -q -- "--web-only" "$WORKSPACE_DIR/start-even.sh"; then
      echo "[webui-docker] Updating workspace start-even.sh from image seed (adds --web-only support)"
      cp "$SEED_DIR/start-even.sh" "$WORKSPACE_DIR/start-even.sh"
      chmod +x "$WORKSPACE_DIR/start-even.sh" || true
    fi
  fi
}

acquire_workspace_lock
seed_workspace_if_needed
release_workspace_lock

cd "$WORKSPACE_DIR"

MODE="${WEBUI_MODE:-even}"
PORT="${PORT:-5173}"
EDITOR_PORT="${EDITOR_PORT:-5174}"
LANDING_PORT="${LANDING_PORT:-8080}"
APP_NAME="${APP_NAME:-base_app}"
APP_PATH="${APP_PATH:-}"
PREFETCH_ON_START="${PREFETCH_REGISTRY_APPS_ON_START:-0}"

ensure_npm_deps() {
  local dir="$1"
  if [ ! -f "$dir/package.json" ]; then
    return 0
  fi
  if [ ! -d "$dir/node_modules" ]; then
    echo "[webui-docker] Installing dependencies in $dir"
    npm --prefix "$dir" install
    return 0
  fi
  if ! npm --prefix "$dir" ls --depth=0 >/dev/null 2>&1; then
    echo "[webui-docker] Refreshing dependencies in $dir"
    npm --prefix "$dir" install
  fi

  # If the repo is bind-mounted from the host, native optional deps used by
  # Vite/Rollup may be missing or built for the wrong platform. Detect and repair.
  if ! vite_tooling_ok "$dir"; then
    echo "[webui-docker] Vite/Rollup native tooling check failed in $dir; reinstalling for container platform"
    rm -rf "$dir/node_modules"
    npm --prefix "$dir" install
    if ! vite_tooling_ok "$dir"; then
      echo "[webui-docker] Dependency repair failed in $dir" >&2
      exit 1
    fi
  fi
}

vite_tooling_ok() {
  local dir="$1"

  # Only run the check for projects that use Vite.
  (
    cd "$dir" &&
      node -e '
        const fs = require("fs");
        const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
        const all = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
        const uses = ("vite" in all);
        process.exit(uses ? 0 : 10);
      ' >/dev/null 2>&1
  )
  local check_status=$?
  if [ "$check_status" -ne 0 ]; then
    [ "$check_status" -eq 10 ] && return 0
    return 1
  fi

  (
    cd "$dir" &&
      npx vite --version >/dev/null 2>&1
  )
}

resolve_registry_git_url() {
  local name="$1"
  APP_LOOKUP_NAME="$name" node -e '
    const fs = require("fs");
    const name = process.env.APP_LOOKUP_NAME;
    if (!fs.existsSync("apps.json")) process.exit(0);
    const map = JSON.parse(fs.readFileSync("apps.json", "utf8"));
    const raw = map[name];
    if (typeof raw !== "string") process.exit(0);
    const base = raw.split("#")[0];
    if (base.startsWith("https://") || base.startsWith("git@")) {
      console.log(base);
    }
  '
}

ensure_selected_app_ready() {
  if [ -n "$APP_PATH" ]; then
    ensure_npm_deps "$APP_PATH"
    return 0
  fi

  if [ -d "apps/$APP_NAME" ]; then
    ensure_npm_deps "apps/$APP_NAME"
    return 0
  fi

  if [ -d ".apps-cache/$APP_NAME" ]; then
    ensure_npm_deps ".apps-cache/$APP_NAME"
    return 0
  fi

  local git_url=""
  git_url="$(resolve_registry_git_url "$APP_NAME" || true)"
  if [ -n "$git_url" ]; then
    mkdir -p .apps-cache
    echo "[webui-docker] Cloning registry app $APP_NAME from $git_url"
    git clone "$git_url" ".apps-cache/$APP_NAME"
    ensure_npm_deps ".apps-cache/$APP_NAME"
    return 0
  fi

  echo "[webui-docker] App '$APP_NAME' was not found in apps/ or apps.json" >&2
  exit 1
}

ensure_npm_deps "."

if [ "$PREFETCH_ON_START" = "1" ]; then
  "$RUNTIME_DIR/scripts/prefetch-registry-apps.sh" "$WORKSPACE_DIR" || true
fi

case "$MODE" in
  even)
    export APP_NAME
    export PORT
    export VITE_HOST="0.0.0.0"
    if [ -n "$APP_PATH" ]; then
      export APP_PATH
    fi
    if [ -x "./start-even.sh" ] && grep -q -- "--web-only" "./start-even.sh"; then
      echo "[webui-docker] Starting via start-even.sh --web-only (APP_NAME=$APP_NAME, PORT=$PORT)"
      exec ./start-even.sh --web-only
    fi

    # Backward-compatible fallback for older workspace copies that do not support --web-only.
    echo "[webui-docker] start-even.sh --web-only unavailable, falling back to direct Vite startup"
    ensure_selected_app_ready
    echo "[webui-docker] Starting even-dev web UI for APP_NAME=$APP_NAME on :$PORT"
    exec npx vite --host 0.0.0.0 --port "$PORT"
    ;;
  editor)
    ensure_npm_deps "misc/editor"
    echo "[webui-docker] Starting misc/editor on :$EDITOR_PORT"
    cd misc/editor
    exec npx vite --host 0.0.0.0 --port "$EDITOR_PORT"
    ;;
  landing)
    echo "[webui-docker] Starting landing page on :$LANDING_PORT"
    export LANDING_PORT
    export WORKSPACE_DIR="$WORKSPACE_DIR"
    exec node "$RUNTIME_DIR/landing/server.js"
    ;;
  *)
    echo "[webui-docker] Unsupported WEBUI_MODE='$MODE' (expected 'even', 'editor', or 'landing')" >&2
    exit 1
    ;;
esac
