#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-/workspace/even-dev}"
cd "$TARGET_DIR"

if [ ! -f apps.json ]; then
  echo "[webui-docker] apps.json not found, skipping registry prefetch"
  exit 0
fi

mkdir -p .apps-cache

while IFS= read -r app_name; do
  [ -z "$app_name" ] && continue

  raw_entry="$(APP_LOOKUP_NAME="$app_name" node -e '
    const fs = require("fs");
    const name = process.env.APP_LOOKUP_NAME;
    const map = JSON.parse(fs.readFileSync("apps.json", "utf8"));
    const raw = map[name];
    if (typeof raw === "string" && raw.length > 0) console.log(raw);
  ')"

  base_url="${raw_entry%%#*}"
  if [[ "$base_url" != https://* && "$base_url" != git@* ]]; then
    continue
  fi

  if [ ! -d ".apps-cache/$app_name/.git" ]; then
    echo "[webui-docker] Cloning $app_name"
    git clone "$base_url" ".apps-cache/$app_name"
  else
    echo "[webui-docker] Updating $app_name"
    git -C ".apps-cache/$app_name" fetch --all --prune || true
    git -C ".apps-cache/$app_name" pull --ff-only || true
  fi

  if [ -f ".apps-cache/$app_name/package.json" ]; then
    echo "[webui-docker] Installing dependencies for $app_name"
    npm --prefix ".apps-cache/$app_name" install || true
  fi
done < <(node -e 'Object.keys(JSON.parse(require("fs").readFileSync("apps.json","utf8"))).forEach(k => console.log(k))')
