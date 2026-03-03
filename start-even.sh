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
WEB_ONLY_MODE=0
SIM_ONLY_MODE=0
CLI_APP_NAME=""
UPDATE_MODE=0
UPDATE_TARGET=""
RESET_MODE=0
DEVENV_UPDATE_MODE=0
EVENHUB_MODE=0
EVENHUB_ARGS=()
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
    --devenv-update)
      DEVENV_UPDATE_MODE=1
      ;;
    --reset)
      RESET_MODE=1
      ;;
    --evenhub-cli)
      EVENHUB_MODE=1
      shift
      while [ "$#" -gt 0 ]; do
        EVENHUB_ARGS+=("$1")
        shift
      done
      break
      ;;
    --web-only)
      WEB_ONLY_MODE=1
      ;;
    --sim-only)
      SIM_ONLY_MODE=1
      ;;
    --*)
      echo "Unknown option: $1" >&2
      echo "Usage: ./start-even.sh [app-name] [--update [app-name]] [--web-only] [--sim-only] [--reset] [--evenhub-cli <args...>]" >&2
      exit 1
      ;;
    *)
      if [ -z "${CLI_APP_NAME}" ]; then
        CLI_APP_NAME="$1"
      else
        echo "Unexpected extra argument: $1" >&2
        echo "Usage: ./start-even.sh [app-name] [--update [app-name]] [--web-only] [--sim-only] [--reset] [--evenhub-cli <args...>]" >&2
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

if [ "${EVENHUB_MODE}" -eq 1 ] && [ "${#EVENHUB_ARGS[@]}" -eq 0 ]; then
  EVENHUB_ARGS=(--help)
fi

if [ "${EVENHUB_MODE}" -eq 1 ] && [ "${RESET_MODE}" -eq 1 ]; then
  echo "Do not combine --evenhub-cli with --reset." >&2
  exit 1
fi

if [ "${DEVENV_UPDATE_MODE}" -eq 1 ] && { [ -n "${CLI_APP_NAME}" ] || [ "${UPDATE_MODE}" -eq 1 ] || [ "${WEB_ONLY_MODE}" -eq 1 ] || [ "${SIM_ONLY_MODE}" -eq 1 ] || [ "${RESET_MODE}" -eq 1 ] || [ "${EVENHUB_MODE}" -eq 1 ]; }; then
  echo "--devenv-update cannot be combined with other launcher modes." >&2
  exit 1
fi

if [ "${RESET_MODE}" -eq 1 ] && [ -n "${CLI_APP_NAME}" ]; then
  echo "Do not pass an app name with --reset." >&2
  exit 1
fi

if [ "${EVENHUB_MODE}" -eq 1 ]; then
  echo "Running evenhub-cli: ${EVENHUB_ARGS[*]}"
  npx @evenrealities/evenhub-cli "${EVENHUB_ARGS[@]}"
  exit $?
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
  ./start-even.sh                        # interactive app selection
  ./start-even.sh <app-name>             # run one app directly
  ./start-even.sh --update               # refresh all git apps from apps.json
  ./start-even.sh --update <name>        # refresh one git app from apps.json
  ./start-even.sh --devenv-update        # refresh root and apps/* npm dependencies
  ./start-even.sh --reset                # remove generated caches/build outputs
  ./start-even.sh --evenhub-cli --help   # evenhub-cli launcher

  Docker experiment:
    APP_NAME=base_app ./start-even.sh --web-only         # run web app only (no simulator)
    URL=http://localhost:5173 ./start-even.sh --sim-only # run simulator only (no web server)
EOF
}

reset_generated_files () {
  local app_dir
  local link_path

  echo "RESET MODE: removing generated files and folders..."

  read -r -p "This removes caches/build outputs (node_modules, dist, .apps-cache, plugin symlinks). Continue? [y/N]: " confirm
  case "${confirm}" in
    y|Y|yes|YES) ;;
    *)
      echo "Reset cancelled."
      return 0
      ;;
  esac

  if [ -d ".apps-cache" ]; then
    rm -rf ".apps-cache"
    echo "Removed .apps-cache/"
  fi

  if [ -d "node_modules" ]; then
    rm -rf "node_modules"
    echo "Removed node_modules/"
  fi

  while IFS= read -r app_dir; do
    if [ -d "${app_dir}/node_modules" ]; then
      rm -rf "${app_dir}/node_modules"
      echo "Removed ${app_dir}/node_modules/"
    fi

    if [ -d "${app_dir}/dist" ]; then
      rm -rf "${app_dir}/dist"
      echo "Removed ${app_dir}/dist/"
    fi

    if [ -f "${app_dir}/out.ehpk" ]; then
      rm -f "${app_dir}/out.ehpk"
      echo "Removed ${app_dir}/out.ehpk"
    fi
  done < <(find "apps" -mindepth 1 -maxdepth 1 -type d ! -name '_*' ! -name '.*' | sort)

  if [ -d "vite-plugins" ]; then
    while IFS= read -r link_path; do
      rm -f "${link_path}"
      echo "Removed generated plugin link ${link_path}"
    done < <(find "vite-plugins" -maxdepth 1 -type l -name '*-plugin.ts' | sort)
  fi

  if [ -d "misc/editor/node_modules" ]; then
    rm -rf "misc/editor/node_modules"
    echo "Removed misc/editor/node_modules/"
  fi

  echo "Reset complete."
}

refresh_devenv_dependencies () {
  local app_dir

  echo "EVEN-DEV DEPENDENCY UPDATE"
  echo "|- Root: clean node_modules and package-lock.json"
  rm -rf node_modules package-lock.json
  echo "|- Root: install dependencies from package.json"
  npm install

  [ -d "apps" ] || return 0

  while IFS= read -r app_dir; do
    [ -f "${app_dir}/package.json" ] || continue
    echo "|- ${app_dir}: clean node_modules and package-lock.json"
    rm -rf "${app_dir}/node_modules" "${app_dir}/package-lock.json"
    echo "|- ${app_dir}: install dependencies from package.json"
    npm --prefix "${app_dir}" install
  done < <(find "apps" -mindepth 1 -maxdepth 1 -type d ! -name '_*' ! -name '.*' | sort)
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

is_standalone_app_dir () {
  local dir="$1"

  [ -d "${dir}" ] || return 1
  [ -f "${dir}/index.html" ] || return 1

  if [ -f "${dir}/src/main.ts" ] || [ -f "${dir}/src/main.tsx" ] || [ -f "${dir}/src/main.js" ] || [ -f "${dir}/src/main.jsx" ]; then
    return 0
  fi

  return 1
}

ensure_standalone_app_dir () {
  local dir="$1"
  local app_name="$2"
  local source_label="$3"

  if [ -n "${dir}" ] && ! is_standalone_app_dir "${dir}"; then
    echo "${source_label} app '${app_name}' is missing standalone files (expected ${dir}/index.html and ${dir}/src/main.*)." >&2
    exit 1
  fi
}

install_app_dependencies_if_needed () {
  local dir="$1"

  if [ -z "${dir}" ] || [ ! -f "${dir}/package.json" ]; then
    return
  fi

  if [ ! -d "${dir}/node_modules" ]; then
    echo "Installing dependencies for ${dir}..."
    npm --prefix "${dir}" install
    return
  fi

  if ! npm --prefix "${dir}" ls --depth=0 >/dev/null 2>&1; then
    echo "Refreshing dependencies for ${dir} (existing node_modules is stale or incomplete)..."
    npm --prefix "${dir}" install
  fi
}

clone_selected_registry_app_if_needed () {
  local selected_app="$1"

  [ -f "apps.json" ] || return 0

  local app_url
  app_url="$(node -e "
    const r = JSON.parse(require('fs').readFileSync('apps.json','utf8'));
    const v = r['${selected_app}'] || '';
    const base = v.split('#')[0];
    if (base.startsWith('https://') || base.startsWith('git@')) console.log(base);
  ")"

  if [ -z "${app_url}" ]; then
    return 0
  fi

  local cache_dir=".apps-cache/${selected_app}"
  if [ ! -d "${cache_dir}" ]; then
    echo "Cloning ${selected_app} from ${app_url}..."
    git clone "${app_url}" "${cache_dir}"
  fi
}

resolve_selected_app_dir () {
  local selected_app="$1"

  if [ -d "apps/${selected_app}" ]; then
    echo "apps/${selected_app}"
    return
  fi

  if [ -d ".apps-cache/${selected_app}" ]; then
    echo ".apps-cache/${selected_app}"
    return
  fi

  echo ""
}

source_label_for_app_dir () {
  local dir="$1"
  case "${dir}" in
    apps/*) echo "Built-in" ;;
    .apps-cache/*) echo "Registry" ;;
    *) echo "Selected" ;;
  esac
}

prepare_selected_app_dir () {
  local app_dir="$1"
  local selected_app="$2"

  [ -n "${app_dir}" ] || return 0

  local source_label
  source_label="$(source_label_for_app_dir "${app_dir}")"
  ensure_standalone_app_dir "${app_dir}" "${selected_app}" "${source_label}"
  RESOLVED_APP_PATH="$(cd "${app_dir}" && pwd)"
  echo "App mode: standalone (${app_dir})"
  install_app_dependencies_if_needed "${app_dir}"
}

sync_app_vite_plugin_links () {
  local root_plugins_dir="vite-plugins"
  local scan_root=""
  local app_dir=""
  local app_name=""
  local plugin_source=""
  local link_path=""
  local link_target=""
  local linked_names=""

  mkdir -p "${root_plugins_dir}"

  for scan_root in "apps" ".apps-cache"; do
    [ -d "${scan_root}" ] || continue

    while IFS= read -r app_dir; do
      app_name="$(basename "${app_dir}")"
      plugin_source="${app_dir}/vite-plugin.ts"
      [ -f "${plugin_source}" ] || continue

      case ",${linked_names}," in
        *",${app_name},"*)
          echo "Plugin link collision for '${app_name}': keeping first match and skipping '${plugin_source}'." >&2
          continue
          ;;
      esac

      link_path="${root_plugins_dir}/${app_name}-plugin.ts"
      link_target="../${plugin_source}"

      if [ -e "${link_path}" ] && [ ! -L "${link_path}" ]; then
        echo "Skipping plugin symlink '${link_path}' from '${app_dir}': file exists and is not a symlink." >&2
        continue
      fi

      ln -snf "${link_target}" "${link_path}"
      linked_names="${linked_names},${app_name}"
    done < <(find "${scan_root}" -mindepth 1 -maxdepth 1 -type d ! -name '_*' ! -name '.*' | sort)
  done
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

if [ "${RESET_MODE}" -eq 1 ]; then
  reset_generated_files
  exit $?
fi

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

if [ "${DEVENV_UPDATE_MODE}" -eq 1 ]; then
  refresh_devenv_dependencies
  exit $?
fi

if [ "${ORIGINAL_ARGC}" -eq 0 ] && [ -z "${APP_NAME}" ] && [ -z "${APP_PATH}" ]; then
  print_cli_hints
fi

if [ "${WEB_ONLY_MODE}" -eq 1 ] && [ "${SIM_ONLY_MODE}" -eq 1 ]; then
  echo "Use either --web-only or --sim-only (not both)." >&2
  exit 1
fi

if [ "${SIM_ONLY_MODE}" -eq 1 ]; then
  echo "SIM_ONLY mode enabled: launching simulator only (expects app already running at ${URL})"
  echo "Launching Even Hub Simulator..."

  SIM_ARGS=()
  if [ -n "${AUDIO_DEVICE}" ]; then
    SIM_ARGS+=("--aid" "${AUDIO_DEVICE}")
  fi
  # shellcheck disable=SC2206
  SIM_ARGS+=(${SIM_OPTS})
  SIM_ARGS+=("${URL}")
  npx --yes @evenrealities/evenhub-simulator@latest "${SIM_ARGS[@]}"
  exit $?
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
  ensure_standalone_app_dir "${RESOLVED_APP_PATH}" "${SELECTED_APP}" "Selected"
  install_app_dependencies_if_needed "${RESOLVED_APP_PATH}"
else
  RESOLVED_APP_PATH=""
  SELECTED_APP="$(resolve_app_selection)"
  echo "Selected app: ${SELECTED_APP}"

  clone_selected_registry_app_if_needed "${SELECTED_APP}"
  APP_DIR="$(resolve_selected_app_dir "${SELECTED_APP}")"
  prepare_selected_app_dir "${APP_DIR}" "${SELECTED_APP}"
fi

sync_app_vite_plugin_links

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

if [ "${WEB_ONLY_MODE}" -eq 1 ]; then
  echo "WEB_ONLY mode enabled: simulator launch skipped. Vite server is running at ${URL}"
  wait "${VITE_PID}"
  exit $?
fi

echo "Launching Even Hub Simulator..."

SIM_ARGS=()
if [ -n "${AUDIO_DEVICE}" ]; then
  SIM_ARGS+=("--aid" "${AUDIO_DEVICE}")
fi
# shellcheck disable=SC2206
SIM_ARGS+=(${SIM_OPTS})
SIM_ARGS+=("${URL}")
npx --yes @evenrealities/evenhub-simulator@latest "${SIM_ARGS[@]}"
