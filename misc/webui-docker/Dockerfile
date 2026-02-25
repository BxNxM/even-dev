FROM node:20-bookworm-slim

ARG PREFETCH_REGISTRY_APPS=0

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=development
ENV WEBUI_MODE=even
ENV APP_NAME=base_app
ENV PORT=5173
ENV EDITOR_PORT=5174
ENV LANDING_PORT=8080

WORKDIR /opt/even-dev-seed

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash curl git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy only the repo parts needed for the web UI/editor image to keep build context smaller.
COPY package.json /opt/even-dev-seed/package.json
COPY README.md /opt/even-dev-seed/README.md
COPY LICENSE /opt/even-dev-seed/LICENSE
COPY apps.json /opt/even-dev-seed/apps.json
COPY vite.config.ts /opt/even-dev-seed/vite.config.ts
COPY start-even.sh /opt/even-dev-seed/start-even.sh
COPY vite-plugins /opt/even-dev-seed/vite-plugins
COPY apps /opt/even-dev-seed/apps
COPY misc/editor /opt/even-dev-seed/misc/editor
COPY misc/editor.sh /opt/even-dev-seed/misc/editor.sh

# Runtime scripts/assets live outside the persistent workspace volume so updates are always visible.
COPY misc/webui-docker/entrypoint.sh /opt/webui-docker/entrypoint.sh
COPY misc/webui-docker/scripts /opt/webui-docker/scripts
COPY misc/webui-docker/landing /opt/webui-docker/landing

RUN chmod +x /opt/webui-docker/entrypoint.sh \
    /opt/webui-docker/scripts/prefetch-registry-apps.sh \
 && npm install \
 && for dir in apps/*; do \
      if [ -f "$dir/package.json" ]; then \
        npm --prefix "$dir" install; \
      fi; \
    done \
 && npm --prefix misc/editor install \
 && if [ "$PREFETCH_REGISTRY_APPS" = "1" ]; then \
      /opt/webui-docker/scripts/prefetch-registry-apps.sh /opt/even-dev-seed; \
    fi

EXPOSE 5173 5174 8080

ENTRYPOINT ["/opt/webui-docker/entrypoint.sh"]
