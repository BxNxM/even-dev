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
AUDIO_DEVICE="${AUDIO_DEVICE:-}"
SIM_OPTS="${SIM_OPTS:-}"
CLI_APP_NAME=""
UPDATE_MODE=0
UPDATE_TARGET=""
ORIGINAL_ARGC="$#"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --update)
      UPDATE_MODE=1
      if [ "$#" -gt 1 ] && [[ "${2}" != --* ]]; then
        UPDATE_TARGET="${2}"
        shift
      fi
      ;;
    --*)
      echo "Unknown option: $1" >&2
      echo "Usage: ./start-even.sh [app-name] [--update [app-name]]" >&2
      exit 1
      ;;
    *)
      if [ -z "${CLI_APP_NAME}" ]; then
        CLI_APP_NAME="$1"
      else
        echo "Unexpected extra argument: $1" >&2
        echo "Usage: ./start-even.sh [app-name] [--update [app-name]]" >&2
        exit 1
      fi
      ;;
  esac
  shift
done

if [ "${UPDATE_MODE}" -eq 1 ] && [ -n "${CLI_APP_NAME}" ] && [ -z "${UPDATE_TARGET}" ]; then
  echo "When using --update with an app name, pass it as: --update <app-name>" >&2
  exit 1
fi

echo "Starting Even Hub development environment... ${URL}"
echo "
                                                    ░░███
  ██████  █████ █████  ██████  ████████           ███████   ██████  █████ █████
 ███░░███░░███ ░░███  ███░░███░░███░░███  ██████ ███░░███  ███░░███░░███ ░░███
░███████  ░███  ░███ ░███████  ░███ ░███ ░░░░░░ ░███ ░███ ░███████  ░███  ░███
░███░░░   ░░███ ███  ░███░░░   ░███ ░███        ░███ ░███ ░███░░░   ░░███ ███
░░██████   ░░█████   ░░██████  ████ █████       ░░████████░░██████   ░░█████
 ░░░░░░     ░░░░░     ░░░░░░  ░░░░ ░░░░░         ░░░░░░░░  ░░░░░░     ░░░░░
                                                                                   "

# --------------------------------------------------
# Helpers
# --------------------------------------------------

command_exists () {
  command -v "$1" >/dev/null 2>&1
}

print_cli_hints () {
  cat <<'EOF'
Command hints:
  ./start-even.sh                  # interactive app selection
  ./start-even.sh <app-name>       # run one app directly
  ./start-even.sh --update         # refresh all git apps from apps.json
  ./start-even.sh --update <name>  # refresh one git app from apps.json
EOF
}

get_registry_entry () {
  local app_name="$1"
  APP_LOOKUP_NAME="${app_name}" node -e "
    const fs = require('fs');
    const name = process.env.APP_LOOKUP_NAME;
    if (!fs.existsSync('apps.json')) process.exit(0);
    const map = JSON.parse(fs.readFileSync('apps.json', 'utf8'));
    const value = map[name];
    if (typeof value === 'string' && value.length > 0) {
      console.log(value);
    }
  " 2>/dev/null
}

is_git_url () {
  local value="$1"
  [[ "${value}" == https://* || "${value}" == git@* ]]
}

update_cached_app () {
  local app_name="$1"
  local raw_entry
  local base_url
  local cache_dir
  local stash_name
  local stashed=0

  raw_entry="$(get_registry_entry "${app_name}")"
  if [ -z "${raw_entry}" ]; then
    echo "Registry app '${app_name}' was not found in apps.json." >&2
    return 1
  fi

  base_url="${raw_entry%%#*}"
  if ! is_git_url "${base_url}"; then
    echo "Skipping '${app_name}': registry entry is a local path (${raw_entry})"
    return 0
  fi

  cache_dir=".apps-cache/${app_name}"
  if [ ! -d "${cache_dir}/.git" ]; then
    mkdir -p ".apps-cache"
    echo "Cloning ${app_name} from ${base_url}..."
    git clone "${base_url}" "${cache_dir}"
    return 0
  fi

  echo "Updating ${app_name} in ${cache_dir}..."
  git -C "${cache_dir}" fetch --all --prune

  if ! git -C "${cache_dir}" diff --quiet || ! git -C "${cache_dir}" diff --cached --quiet || [ -n "$(git -C "${cache_dir}" ls-files --others --exclude-standard)" ]; then
    stash_name="even-dev-auto-stash-${app_name}-$(date +%Y%m%d-%H%M%S)"
    echo "Local changes detected in ${cache_dir}; stashing as '${stash_name}'..."
    git -C "${cache_dir}" stash push --include-untracked -m "${stash_name}" >/dev/null
    stashed=1
  fi

  git -C "${cache_dir}" pull --ff-only

  if [ "${stashed}" -eq 1 ]; then
    echo "Update completed for ${app_name}. Local changes are saved in git stash (${stash_name})."
  fi
}

refresh_apps_cache () {
  local updated=0
  local app_name

  if [ ! -f "apps.json" ]; then
    echo "apps.json was not found." >&2
    return 1
  fi

  if ! command_exists git; then
    echo "git is not installed." >&2
    return 1
  fi

  if [ -n "${UPDATE_TARGET}" ]; then
    update_cached_app "${UPDATE_TARGET}"
    return $?
  fi

  while IFS= read -r app_name; do
    [ -z "${app_name}" ] && continue
    update_cached_app "${app_name}"
    updated=$((updated + 1))
  done < <(node -e "Object.keys(JSON.parse(require('fs').readFileSync('apps.json','utf8'))).forEach(k=>console.log(k))")

  if [ "${updated}" -eq 0 ]; then
    echo "No registry apps found in apps.json."
  else
    echo "Updated ${updated} registry app(s)."
  fi
}

resolve_app_location () {
  local app_name="$1"

  if [ -f "apps.json" ]; then
    local configured_location
    configured_location="$(get_registry_entry "${app_name}")"
    if [ -n "${configured_location}" ]; then
      local display_location="${configured_location}"
      display_location="${display_location#https://}"
      echo ".apps-cache: ${display_location}"
      return
    fi
  fi

  if [ -d "apps/${app_name}" ]; then
    echo "apps/${app_name}"
    return
  fi

  if [ -n "${APP_NAME}" ] && [ -n "${APP_PATH}" ] && [ "${APP_NAME}" = "${app_name}" ]; then
    echo "local:${APP_PATH}"
    return
  fi

  echo "-"
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

  # Keep discovery order: built-in apps first, then apps.json entries.
  # Deduplicate while preserving first occurrence.
  printf '%s\n' "${apps[@]}" | awk '!seen[$0]++'
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
  printf "  %-4s %-20s %s\n" "ID" "NAME" "SOURCE" >&2
  printf "  %-4s %-20s %s\n" "----" "--------------------" "----------------------------------------" >&2
  for i in "${!apps[@]}"; do
    app_location="$(resolve_app_location "${apps[$i]}")"
    printf "  %-4s %-20s %s\n" "$((i + 1))" "${apps[$i]}" "${app_location}" >&2
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

if [ "${UPDATE_MODE}" -eq 1 ]; then
  refresh_apps_cache
  exit $?
fi

if ! command_exists npm; then
  echo "npm is not installed."
  exit 1
fi

if [ "${ORIGINAL_ARGC}" -eq 0 ] && [ -z "${APP_NAME}" ] && [ -z "${APP_PATH}" ]; then
  print_cli_hints
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

SIM_ARGS=()
if [ -n "${AUDIO_DEVICE}" ]; then
  SIM_ARGS+=("--aid" "${AUDIO_DEVICE}")
fi
# shellcheck disable=SC2206
SIM_ARGS+=(${SIM_OPTS})
SIM_ARGS+=("${URL}")
npx --yes @evenrealities/evenhub-simulator@latest "${SIM_ARGS[@]}"
