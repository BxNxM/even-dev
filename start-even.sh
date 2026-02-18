#!/usr/bin/env bash

# =========================
# Even Hub Dev Launcher
# =========================

set -e

VITE_HOST="${VITE_HOST:-0.0.0.0}"
SIM_HOST="${SIM_HOST:-127.0.0.1}"
PORT="${PORT:-5173}"
URL="${URL:-http://${SIM_HOST}:${PORT}}"
APP_NAME="${APP_NAME:-}"
APP_PATH="${APP_PATH:-}"
CLI_APP_NAME="${1:-}"

echo "Starting Even Hub development environment... ${URL}"

# --------------------------------------------------
# Helpers
# --------------------------------------------------

command_exists () {
  command -v "$1" >/dev/null 2>&1
}

discover_apps () {
  local apps=()

  # Built-in apps from apps/ directory
  if [ -d "apps" ]; then
    while IFS= read -r app; do
      apps+=("$app")
    done < <(find apps -mindepth 1 -maxdepth 1 -type d ! -name '_*' ! -name '.*' -exec basename {} \;)
  fi

  # External apps from apps.json
  if [ -f "apps.json" ]; then
    while IFS= read -r app; do
      apps+=("$app")
    done < <(node -e "Object.keys(JSON.parse(require('fs').readFileSync('apps.json','utf8'))).forEach(k=>console.log(k))")
  fi

  # APP_PATH override adds to the list too
  if [ -n "${APP_NAME}" ] && [ -n "${APP_PATH}" ]; then
    apps+=("${APP_NAME}")
  fi

  printf '%s\n' "${apps[@]}" | sort -u
}

resolve_app_selection () {
  local apps=()
  while IFS= read -r app; do
    apps+=("$app")
  done < <(discover_apps)

  if [ "${#apps[@]}" -eq 0 ]; then
    echo "No apps found. Create at least one app folder under ./apps (for example apps/demo)." >&2
    exit 1
  fi

  if [ -n "${APP_NAME}" ]; then
    for app in "${apps[@]}"; do
      if [ "${app}" = "${APP_NAME}" ]; then
        echo "${APP_NAME}"
        return
      fi
    done

    echo "APP_NAME '${APP_NAME}' not found in built-in apps or apps.json." >&2
    echo "Available apps: ${apps[*]}" >&2
    exit 1
  fi

  if [ "${#apps[@]}" -eq 1 ]; then
    echo "${apps[0]}"
    return
  fi

  echo "Available apps:" >&2
  for i in "${!apps[@]}"; do
    printf "  %d) %s\n" "$((i + 1))" "${apps[$i]}" >&2
  done

  read -r -p "Select app [1-${#apps[@]}] (default 1): " app_index >&2
  if [ -z "${app_index}" ]; then
    app_index=1
  fi

  if ! [[ "${app_index}" =~ ^[0-9]+$ ]] || [ "${app_index}" -lt 1 ] || [ "${app_index}" -gt "${#apps[@]}" ]; then
    echo "Invalid app selection: ${app_index}" >&2
    exit 1
  fi

  echo "${apps[$((app_index - 1))]}"
}

# --------------------------------------------------
# Check Node / npm
# --------------------------------------------------

if ! command_exists node; then
  echo "Node.js is not installed."
  exit 1
fi

if ! command_exists npm; then
  echo "npm is not installed."
  exit 1
fi

# --------------------------------------------------
# Ensure local dependencies installed
# --------------------------------------------------

if [ ! -d "node_modules" ]; then
  echo "Installing project dependencies..."
  npm install
fi

# --------------------------------------------------
# Ensure Vite installed locally
# --------------------------------------------------

if [ ! -d "node_modules/vite" ]; then
  echo "Installing vite locally..."
  npm install --save-dev vite
fi

# --------------------------------------------------
# Start Vite server
# --------------------------------------------------

echo "Starting Vite dev server..."

if [ -n "${CLI_APP_NAME}" ]; then
  APP_NAME="${CLI_APP_NAME}"
fi

# --------------------------------------------------
# APP_PATH shortcut: point to a local directory, skip selection
# --------------------------------------------------

if [ -n "${APP_PATH}" ]; then
  RESOLVED_APP_PATH="$(cd "${APP_PATH}" && pwd)"
  if [ -z "${APP_NAME}" ]; then
    APP_NAME="$(basename "${RESOLVED_APP_PATH}")"
  fi
  SELECTED_APP="${APP_NAME}"
  echo "Selected app: ${SELECTED_APP} (from APP_PATH=${APP_PATH})"

  if [ -f "${RESOLVED_APP_PATH}/package.json" ] && [ ! -d "${RESOLVED_APP_PATH}/node_modules" ]; then
    echo "Installing dependencies for ${RESOLVED_APP_PATH}..."
    npm --prefix "${RESOLVED_APP_PATH}" install
  fi
else
  RESOLVED_APP_PATH=""
  SELECTED_APP="$(resolve_app_selection)"
  echo "Selected app: ${SELECTED_APP}"

  # --------------------------------------------------
  # Clone selected app from apps.json if it's a git URL
  # --------------------------------------------------

  if [ -f "apps.json" ]; then
    APP_URL="$(node -e "
      const r = JSON.parse(require('fs').readFileSync('apps.json','utf8'));
      const v = r['${SELECTED_APP}'] || '';
      const base = v.split('#')[0];
      if (base.startsWith('https://') || base.startsWith('git@')) console.log(base);
    ")"
    if [ -n "${APP_URL}" ]; then
      CACHE_DIR=".apps-cache/${SELECTED_APP}"
      if [ ! -d "${CACHE_DIR}" ]; then
        echo "Cloning ${SELECTED_APP} from ${APP_URL}..."
        git clone "${APP_URL}" "${CACHE_DIR}"
      fi
    fi
  fi

  # --------------------------------------------------
  # Ensure selected app dependencies installed (if needed)
  # --------------------------------------------------

  APP_DIR=""
  if [ -d "apps/${SELECTED_APP}" ]; then
    APP_DIR="apps/${SELECTED_APP}"
  elif [ -d ".apps-cache/${SELECTED_APP}" ]; then
    APP_DIR=".apps-cache/${SELECTED_APP}"
  fi

  if [ -n "${APP_DIR}" ] && [ -f "${APP_DIR}/package.json" ] && [ ! -d "${APP_DIR}/node_modules" ]; then
    echo "Installing dependencies for ${APP_DIR}..."
    npm --prefix "${APP_DIR}" install
  fi
fi

VITE_APP_NAME="${SELECTED_APP}" APP_NAME="${SELECTED_APP}" APP_PATH="${RESOLVED_APP_PATH}" npx vite --host "${VITE_HOST}" --port "${PORT}" &

VITE_PID=$!

trap "kill ${VITE_PID}" EXIT

# --------------------------------------------------
# Wait for server to be reachable
# --------------------------------------------------

echo "Waiting for Vite server..."

until curl --output /dev/null --silent --head --fail "$URL"; do
  sleep 1
done

echo "Vite is ready."

# --------------------------------------------------
# Launch simulator
# --------------------------------------------------

echo "Launching Even Hub Simulator..."
if command_exists evenhub-simulator; then
  evenhub-simulator "${URL}"
else
  npx @evenrealities/evenhub-simulator "${URL}"
fi
